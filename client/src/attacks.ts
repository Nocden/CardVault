// Shows that the ON-CHAIN program (not just the client) blocks the attacks.
// Requires: a vault created by OWNER_KEYPAIR, main card on CARD, recovery card on RECOVERY_CARD.
//   CARD=sim:9025 RECOVERY_CARD=sim:9026 RPC_URL=http://127.0.0.1:8899 npm run attacks
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { openCard } from "./card.js";
import { compressPubkey, derToRawLowS } from "./p256.js";
import { TAG_WITHDRAW, buildMessage, fetchVault, secp256r1Instruction, vaultPda, withdrawIx } from "./vault.js";

const conn = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
  readFileSync(process.env.OWNER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`, "utf8"))));
const PIN = process.env.CARD_PIN ?? "1234";
const vault = vaultPda(owner.publicKey);
const thief = Keypair.generate().publicKey;

async function sign(spec: string, msg: Buffer) {
  const { card, close } = await openCard(spec);
  const pk = compressPubkey(await card.getPubkey());
  await card.verifyPin(PIN);
  const sig = derToRawLowS(await card.sign(msg));
  close();
  return { pk, sig };
}

async function attempt(name: string, ixs: TransactionInstruction[], expectError: string) {
  try {
    await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [owner]);
    console.log(`  FAIL ${name}: transaction went through!`);
    process.exitCode = 1;
  } catch (e: any) {
    const logs = (e.logs ?? []).join(" ") + " " + (e.message ?? "");
    const ok = logs.includes(expectError);
    console.log(`${ok ? "  OK  " : "  ??  "} ${name} -> blocked (${expectError})`);
    if (!ok) { console.log(logs); process.exitCode = 1; }
  }
}

const state = await fetchVault(conn, vault);
const amount = 100_000_000n; // 0.1 SOL
console.log(`vault ${vault.toBase58()}, nonce ${state.nonce}\n`);

// 1. Stolen Phantom key alone (no card signature at all)
await attempt("stolen owner key, no card", [withdrawIx(owner.publicKey, vault, thief, amount)], "MissingCardSignature");

// 2. Card approved 0.1 SOL, malware submits 0.5 SOL
const m1 = buildMessage(TAG_WITHDRAW, vault, thief, amount, state.nonce);
const s1 = await sign(process.env.CARD ?? "sim:9025", m1);
await attempt("card signed 0.1 SOL, tx asks 0.5 SOL",
  [secp256r1Instruction(s1.pk, s1.sig, m1), withdrawIx(owner.publicKey, vault, thief, 500_000_000n)], "WrongMessage");

// 3. Card approved recipient A, malware swaps recipient
await attempt("card signed recipient A, tx pays recipient B",
  [secp256r1Instruction(s1.pk, s1.sig, m1), withdrawIx(owner.publicKey, vault, Keypair.generate().publicKey, amount)],
  "WrongMessage");

// 4. A different card (e.g. attacker's own card) signs the withdrawal
const s2 = await sign(process.env.RECOVERY_CARD ?? "sim:9026", m1);
await attempt("signature from a card that is not the vault's main card",
  [secp256r1Instruction(s2.pk, s2.sig, m1), withdrawIx(owner.publicKey, vault, thief, amount)], "WrongCard");

// 5. Valid withdrawal goes through, then the same signature is replayed
await sendAndConfirmTransaction(conn,
  new Transaction().add(secp256r1Instruction(s1.pk, s1.sig, m1), withdrawIx(owner.publicKey, vault, thief, amount)), [owner]);
console.log("  OK   legit 0.1 SOL withdrawal with owner + card succeeded");
await attempt("replay of the same card signature", [secp256r1Instruction(s1.pk, s1.sig, m1),
  withdrawIx(owner.publicKey, vault, thief, amount)], "WrongMessage");

// 6. Forged signature bytes: the secp256r1 precompile (instruction 0) rejects
//    the whole transaction before our program even runs.
const bad = Buffer.from(s1.sig); bad[10] ^= 0xff;
const m2 = buildMessage(TAG_WITHDRAW, vault, thief, amount, state.nonce + 1n);
await attempt("forged/corrupted card signature",
  [secp256r1Instruction(s1.pk, bad, m2), withdrawIx(owner.publicKey, vault, thief, amount)],
  "Error processing Instruction 0");
