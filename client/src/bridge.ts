// CardVault bridge: a small local server that
//   - serves the web app (client/web) on http://localhost:8787
//   - talks to the card (PC/SC reader or simulator) - browsers can't do that themselves
//   - builds transactions; the WALLET (Phantom) signs them in the browser
//
//   MAIN_CARD=sim:9025 RECOVERY_CARD=sim:9026 RPC_URL=http://127.0.0.1:8899 npm run bridge
//   npm run bridge                      (real reader, devnet)
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SendTransactionError, SystemProgram, Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { CardError, openCard } from "./card.js";
import { compressPubkey, derToRawLowS } from "./p256.js";
import {
  PROGRAM_ID, TAG_RECOVER, TAG_WITHDRAW, buildMessage, decodeVault, initializeIx, recoverIx,
  secp256r1Instruction, vaultPda, withdrawIx,
} from "./vault.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "web");
const PORT = Number(process.env.PORT ?? 8787);
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const MAIN_CARD = process.env.MAIN_CARD ?? process.env.CARD ?? "pcsc";
const RECOVERY_CARD = process.env.RECOVERY_CARD ?? MAIN_CARD;
const conn = new Connection(RPC, "confirmed");
const VAULT_SIZE = 8 + 32 + 32 + 33 + 33 + 8 + 1;

// Optional local keypairs that stand in for Phantom (testing / demo fallback).
const devWallets: Keypair[] = (process.env.DEV_WALLETS ?? "")
  .split(",").filter(Boolean)
  .map((p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")))));

// ---------- card access (one APDU session at a time) ----------
let cardQueue: Promise<unknown> = Promise.resolve();
function withCard<T>(role: string, fn: (card: Awaited<ReturnType<typeof openCard>>["card"]) => Promise<T>): Promise<T> {
  const spec = role === "recovery" ? RECOVERY_CARD : MAIN_CARD;
  const run = async () => {
    const { card, close } = await openCard(spec, 5_000);
    try { return await fn(card); } finally { close(); }
  };
  const next = cardQueue.then(run, run);
  cardQueue = next.catch(() => undefined);
  return next;
}

async function cardSign(role: string, message: Buffer, pin: string) {
  return withCard(role, async (card) => {
    const pubkey = compressPubkey(await card.getPubkey());
    await card.verifyPin(pin);
    const sig = derToRawLowS(await card.sign(message));
    return { pubkey, sig };
  });
}

// ---------- helpers ----------
const lamports = (sol: unknown) => {
  const n = Number(sol);
  if (!Number.isFinite(n) || n <= 0) throw new UserError("Enter an amount greater than 0");
  return BigInt(Math.round(n * LAMPORTS_PER_SOL));
};
class UserError extends Error {}
function pk(v: unknown, what: string): PublicKey {
  try { return new PublicKey(String(v)); } catch { throw new UserError(`${what} is not a valid Solana address`); }
}

async function loadVault(addr: PublicKey) {
  const acc = await conn.getAccountInfo(addr);
  if (!acc || !acc.owner.equals(PROGRAM_ID)) return null;
  const s = decodeVault(acc.data);
  return { address: addr, ...s, balance: acc.lamports };
}

/** Accepts a vault address or the address of the wallet that created it. */
async function resolveVault(input: unknown) {
  const key = pk(input, "Vault");
  const direct = await loadVault(key);
  if (direct) return direct;
  const v = await loadVault(vaultPda(key));
  if (!v) throw new UserError("No vault found for this address");
  return v;
}

function vaultJson(v: NonNullable<Awaited<ReturnType<typeof loadVault>>>) {
  return {
    address: v.address.toBase58(), creator: v.creator.toBase58(), owner: v.owner.toBase58(),
    balance: v.balance, nonce: v.nonce.toString(),
    card: v.card.toString("hex"), recoveryCard: v.recoveryCard.toString("hex"),
  };
}

async function unsignedTx(feePayer: PublicKey, ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

/** Turns program / precompile failures into plain sentences for the UI. */
function explain(logs: string[], fallback: string): string {
  const all = logs.join("\n") + "\n" + fallback;
  const rules: [RegExp, string][] = [
    [/MissingCardSignature/, "Blocked on-chain: the transaction has no card signature."],
    [/WrongMessage/, "Blocked on-chain: the card approved a different transaction (amount, recipient or nonce)."],
    [/WrongCard/, "Blocked on-chain: signed by a card that does not belong to this vault."],
    [/ConstraintHasOne/, "Blocked on-chain: this wallet is not the owner of the vault."],
    [/InsufficientFunds/, "Not enough SOL in the vault."],
    [/Error processing Instruction 0|precompile|invalid signature/i, "Blocked: the card signature is invalid."],
    [/already in use/, "This wallet already has a vault."],
    [/insufficient (funds|lamports)|Attempt to debit an account but found no record/i,
      "The wallet does not have enough SOL to pay for this."],
  ];
  for (const [re, text] of rules) if (re.test(all)) return text;
  return fallback;
}

// ---------- API ----------
type Body = Record<string, any>;
const routes: Record<string, (b: Body, q: URLSearchParams) => Promise<unknown>> = {
  "GET /api/config": async () => ({
    rpc: RPC, programId: PROGRAM_ID.toBase58(),
    cluster: RPC.includes("devnet") ? "devnet" : RPC.includes("127.0.0.1") || RPC.includes("localhost") ? "local" : "custom",
    sameReader: MAIN_CARD === RECOVERY_CARD,
    devWallets: devWallets.map((k) => k.publicKey.toBase58()),
  }),

  "GET /api/card": async (_b, q) => {
    const role = q.get("role") === "recovery" ? "recovery" : "main";
    return withCard(role, async (card) => {
      const info = await card.getInfo();
      return { role, pubkey: compressPubkey(await card.getPubkey()).toString("hex"),
        limit: info.limit.toString(), pinTries: info.pinTries };
    });
  },

  "GET /api/vaults": async (_b, q) => {
    const wallet = pk(q.get("wallet"), "Wallet");
    const find = (offset: number) => conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: VAULT_SIZE }, { memcmp: { offset, bytes: wallet.toBase58() } }],
    });
    const [asOwner, asCreator] = await Promise.all([find(40), find(8)]);
    const seen = new Map<string, any>();
    for (const a of [...asOwner, ...asCreator]) {
      seen.set(a.pubkey.toBase58(), vaultJson({ address: a.pubkey, ...decodeVault(a.account.data), balance: a.account.lamports }));
    }
    return [...seen.values()];
  },

  "GET /api/vault": async (_b, q) => vaultJson(await resolveVault(q.get("address"))),

  "POST /api/tx/init": async (b) => {
    const owner = pk(b.owner, "Wallet");
    if (await loadVault(vaultPda(owner))) throw new UserError("This wallet already has a vault.");
    const main = await withCard("main", async (c) => compressPubkey(await c.getPubkey()));
    const recoveryHex = String(b.recoveryPubkey ?? "").trim().toLowerCase();
    if (!/^0[23][0-9a-f]{64}$/.test(recoveryHex)) throw new UserError("Read the recovery card first (33-byte public key).");
    const recovery = Buffer.from(recoveryHex, "hex");
    if (recovery.equals(main)) throw new UserError("The recovery card must be a different card than the main card.");
    return { tx: await unsignedTx(owner, [initializeIx(owner, main, recovery)]), vault: vaultPda(owner).toBase58() };
  },

  "POST /api/tx/deposit": async (b) => {
    const from = pk(b.wallet, "Wallet");
    const v = await resolveVault(b.vault);
    return { tx: await unsignedTx(from, [SystemProgram.transfer({ fromPubkey: from, toPubkey: v.address, lamports: lamports(b.sol) })]) };
  },

  "POST /api/tx/withdraw": async (b) => {
    const owner = pk(b.wallet, "Wallet");
    const v = await resolveVault(b.vault);
    const to = pk(b.recipient, "Recipient");
    const amount = lamports(b.sol);
    const msg = buildMessage(TAG_WITHDRAW, v.address, to, amount, v.nonce);
    const { pubkey, sig } = await cardSign("main", msg, String(b.pin ?? ""));
    if (!pubkey.equals(v.card)) throw new UserError("This is not the vault's main card.");
    return { tx: await unsignedTx(owner, [secp256r1Instruction(pubkey, sig, msg), withdrawIx(owner, v.address, to, amount)]) };
  },

  "POST /api/tx/recover": async (b) => {
    const payer = pk(b.wallet, "Wallet");
    const v = await resolveVault(b.vault);
    const newOwner = pk(b.newOwner ?? b.wallet, "New owner");
    const msg = buildMessage(TAG_RECOVER, v.address, newOwner, 0n, v.nonce);
    const { pubkey, sig } = await cardSign("recovery", msg, String(b.pin ?? ""));
    if (!pubkey.equals(v.recoveryCard)) throw new UserError("This is not the vault's recovery card.");
    return { tx: await unsignedTx(payer, [secp256r1Instruction(pubkey, sig, msg), recoverIx(payer, v.address, newOwner)]) };
  },

  // Builds what malware holding the wallet key would try. The UI then sends it,
  // and the program rejects it on-chain.
  "POST /api/tx/attack": async (b) => {
    const wallet = pk(b.wallet, "Wallet");
    const v = await resolveVault(b.vault);
    const thief = Keypair.generate().publicKey;
    const approved = 10_000_000n; // the user approves 0.01 SOL on the card
    if (b.kind === "no-card") {
      return { tx: await unsignedTx(wallet, [withdrawIx(wallet, v.address, thief, v.balance > 0 ? BigInt(Math.min(v.balance, 1e9)) / 2n : 1n)]) };
    }
    // What the user wanted and approved on the card:
    const intended = b.recipient ? pk(b.recipient, "Recipient") : Keypair.generate().publicKey;
    const msg = buildMessage(TAG_WITHDRAW, v.address, intended, approved, v.nonce);
    const { pubkey, sig } = await cardSign("main", msg, String(b.pin ?? ""));
    // What the malware actually puts in the transaction:
    const txAmount = b.kind === "swap-amount" ? approved * 50n : approved;
    const txTo = b.kind === "swap-recipient" ? thief : intended;
    return {
      tx: await unsignedTx(wallet, [secp256r1Instruction(pubkey, sig, msg), withdrawIx(wallet, v.address, txTo, txAmount)]),
      approved: Number(approved) / LAMPORTS_PER_SOL, attempted: Number(txAmount) / LAMPORTS_PER_SOL,
    };
  },

  "POST /api/dev/sign": async (b) => {
    const kp = devWallets.find((k) => k.publicKey.toBase58() === b.wallet);
    if (!kp) throw new UserError("Unknown dev wallet");
    const tx = Transaction.from(Buffer.from(String(b.tx), "base64"));
    tx.partialSign(kp);
    return { tx: tx.serialize({ requireAllSignatures: false }).toString("base64") };
  },

  "POST /api/send": async (b) => {
    const raw = Buffer.from(String(b.tx), "base64");
    let signature: string;
    try {
      signature = await conn.sendRawTransaction(raw, { preflightCommitment: "confirmed" });
    } catch (e: any) {
      const logs: string[] = e instanceof SendTransactionError ? (await e.getLogs(conn).catch(() => e.logs)) ?? [] : [];
      throw new UserError(explain(logs ?? [], e.message ?? String(e)));
    }
    const bh = await conn.getLatestBlockhash();
    const res = await conn.confirmTransaction({ signature, ...bh }, "confirmed");
    if (res.value.err) {
      const t = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
      throw new UserError(explain(t?.meta?.logMessages ?? [], JSON.stringify(res.value.err)));
    }
    return { signature };
  },
};

// ---------- HTTP plumbing ----------
const STATIC: Record<string, [string, string]> = {
  "/": [join(WEB, "index.html"), "text/html; charset=utf-8"],
  "/web3.js": [join(HERE, "..", "node_modules", "@solana", "web3.js", "lib", "index.iife.min.js"), "text/javascript"],
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : {};
}

const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const st = STATIC[url.pathname];
  if (req.method === "GET" && st) {
    if (!existsSync(st[0])) return send(res, 500, { error: `missing ${st[0]} (run npm install)` });
    res.writeHead(200, { "content-type": st[1] });
    return res.end(readFileSync(st[0]));
  }
  // Only this page may use the API: blocks other websites from reaching your card/bridge.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "Forbidden origin" });
  if (req.method === "POST" && req.headers["content-type"] !== "application/json") {
    return send(res, 415, { error: "Expected JSON" });
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: "Not found" });
  try {
    send(res, 200, await route(req.method === "POST" ? await readBody(req) : {}, url.searchParams));
  } catch (e: any) {
    const known = e instanceof UserError || e instanceof CardError || /No card|No simulated card/.test(e?.message ?? "");
    if (!known) console.error(e);
    send(res, known ? 400 : 500, { error: e?.message ?? String(e) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`CardVault bridge: http://localhost:${PORT}`);
  console.log(`  RPC ${RPC}\n  program ${PROGRAM_ID.toBase58()}\n  main card ${MAIN_CARD}, recovery card ${RECOVERY_CARD}`);
  if (devWallets.length) console.log(`  dev wallets: ${devWallets.map((k) => k.publicKey.toBase58()).join(", ")}`);
});
