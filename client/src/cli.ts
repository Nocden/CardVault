// CardVault CLI. The local keypair file plays the role of the Phantom key.
//   CARD=sim:9025 npm run cli -- pubkey        (simulator)
//   npm run cli -- pubkey                       (real card in a PC/SC reader)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { openCard } from "./card.js";
import { compressPubkey, derToRawLowS } from "./p256.js";
import {
  TAG_RECOVER, TAG_WITHDRAW, buildMessage, fetchVault, initializeIx, recoverIx, secp256r1Instruction,
  vaultPda, withdrawIx,
} from "./vault.js";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");

function loadKeypair(path = process.env.OWNER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

const sol = (s: string) => BigInt(Math.round(Number(s) * LAMPORTS_PER_SOL));
const fmt = (l: bigint | number) => `${Number(l) / LAMPORTS_PER_SOL} SOL`;

async function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

/** Asks for the PIN, then has the card sign the message. Returns (pubkey33, sig64). */
async function cardSign(message: Buffer): Promise<{ pubkey: Buffer; sig: Buffer }> {
  const { card, close } = await openCard();
  try {
    const pubkey = compressPubkey(await card.getPubkey());
    await card.verifyPin(await ask("Card PIN: "));
    const der = await card.sign(message);
    return { pubkey, sig: derToRawLowS(der) };
  } finally {
    close();
  }
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async pubkey() {
    const { card, close } = await openCard();
    const pk = compressPubkey(await card.getPubkey());
    const info = await card.getInfo();
    close();
    console.log(`card pubkey: ${pk.toString("hex")}`);
    console.log(`limit: ${fmt(info.limit)}, PIN tries left: ${info.pinTries}`);
  },

  async init([recoveryHex]) {
    if (!recoveryHex) throw new Error("usage: init <recovery-card-pubkey-hex>  (run `pubkey` with the 2nd card)");
    const owner = loadKeypair();
    const { card, close } = await openCard();
    const main = compressPubkey(await card.getPubkey());
    close();
    const tx = new Transaction().add(initializeIx(owner.publicKey, main, Buffer.from(recoveryHex, "hex")));
    const sig = await sendAndConfirmTransaction(conn, tx, [owner]);
    console.log(`vault created: ${vaultPda(owner.publicKey).toBase58()}\ntx: ${sig}`);
  },

  async deposit([amount]) {
    const owner = loadKeypair();
    const vault = vaultPda(owner.publicKey);
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: owner.publicKey, toPubkey: vault, lamports: sol(amount),
    }));
    console.log(`tx: ${await sendAndConfirmTransaction(conn, tx, [owner])}`);
  },

  async withdraw([to, amount]) {
    const owner = loadKeypair();
    const vault = vaultPda(owner.publicKey);
    const recipient = new PublicKey(to);
    const state = await fetchVault(conn, vault);
    const lamports = sol(amount);

    const msg = buildMessage(TAG_WITHDRAW, vault, recipient, lamports, state.nonce);
    console.log(`Withdraw ${fmt(lamports)} to ${recipient.toBase58()} (nonce ${state.nonce})`);
    const { pubkey, sig } = await cardSign(msg);
    if (!pubkey.equals(state.card)) throw new Error("this is not the vault's main card");

    const tx = new Transaction()
      .add(secp256r1Instruction(pubkey, sig, msg))           // card signature check
      .add(withdrawIx(owner.publicKey, vault, recipient, lamports)); // owner (Phantom) signs the tx
    console.log(`tx: ${await sendAndConfirmTransaction(conn, tx, [owner])}`);
  },

  async recover([newOwner, creator]) {
    // Fee payer can be ANY wallet; the recovery card is what authorizes.
    const payer = loadKeypair(process.env.PAYER_KEYPAIR);
    const vault = vaultPda(new PublicKey(creator ?? payer.publicKey.toBase58()));
    const state = await fetchVault(conn, vault);
    const target = new PublicKey(newOwner);

    const msg = buildMessage(TAG_RECOVER, vault, target, 0n, state.nonce);
    console.log(`Recover vault ${vault.toBase58()}: new owner ${target.toBase58()}`);
    const { pubkey, sig } = await cardSign(msg);
    if (!pubkey.equals(state.recoveryCard)) throw new Error("this is not the vault's recovery card");

    const tx = new Transaction()
      .add(secp256r1Instruction(pubkey, sig, msg))
      .add(recoverIx(payer.publicKey, vault, target));
    console.log(`tx: ${await sendAndConfirmTransaction(conn, tx, [payer])}`);
  },

  async info([creator]) {
    const vault = vaultPda(creator ? new PublicKey(creator) : loadKeypair().publicKey);
    const s = await fetchVault(conn, vault);
    const bal = await conn.getBalance(vault);
    console.log({ vault: vault.toBase58(), owner: s.owner.toBase58(), balance: fmt(bal),
      nonce: s.nonce.toString(), card: s.card.toString("hex"), recoveryCard: s.recoveryCard.toString("hex") });
  },

  async "set-limit"([amount]) {
    const { card, close } = await openCard();
    try {
      await card.verifyPin(await ask("Card PIN: "));
      await card.setLimit(sol(amount));
      console.log(`card limit set to ${fmt(sol(amount))} per transaction`);
    } finally { close(); }
  },

  async "change-pin"() {
    const { card, close } = await openCard();
    try {
      await card.verifyPin(await ask("Current PIN: "));
      await card.changePin(await ask("New PIN (4-8 chars): "));
      console.log("PIN changed");
    } finally { close(); }
  },
};

const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd];
if (!fn) {
  console.log(`commands: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
fn(args).catch((e) => { console.error("Error:", e.message ?? e); process.exit(1); });
