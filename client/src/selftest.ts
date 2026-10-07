// Offline end-to-end test: client <-> simulated card, no blockchain needed.
//   1) start the simulator:  ../sim/run.sh 9025
//   2) CARD=sim:9025 npm test
import { createPublicKey, verify } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { CardError, openCard } from "./card.js";
import { compressPubkey, derToRawLowS } from "./p256.js";
import { TAG_WITHDRAW, buildMessage, secp256r1Instruction } from "./vault.js";

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
let n = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? "  OK  " : "  FAIL"} ${name}`);
  if (!cond) process.exit(1);
  n++;
};

const { card, close } = await openCard(process.env.CARD ?? "sim:9025");
const w = await card.getPubkey();
const pk33 = compressPubkey(w);
ok("compressed pubkey is 33 bytes", pk33.length === 33 && (pk33[0] === 2 || pk33[0] === 3));

const jwkKey = createPublicKey({
  key: { kty: "EC", crv: "P-256", x: w.subarray(1, 33).toString("base64url"), y: w.subarray(33).toString("base64url") },
  format: "jwk",
});

const vault = Keypair.generate().publicKey, to = Keypair.generate().publicKey;
for (let i = 0; i < 5; i++) {
  const msg = buildMessage(TAG_WITHDRAW, vault, to, 100_000_000n, BigInt(i));
  await card.verifyPin("1234");
  const raw = derToRawLowS(await card.sign(msg));
  const s = BigInt("0x" + raw.subarray(32).toString("hex"));
  ok(`sig #${i}: 64 bytes, low-S`, raw.length === 64 && s <= N >> 1n);
  ok(`sig #${i}: verifies like the precompile would (SHA-256, P-256)`,
    verify("sha256", msg, { key: jwkKey, dsaEncoding: "ieee-p1363" }, raw));

  // Parse the precompile instruction exactly like the on-chain program does.
  const d = secp256r1Instruction(pk33, raw, msg).data;
  const rd = (o: number) => d.readUInt16LE(o);
  ok(`ix #${i}: layout matches program parser`,
    d[0] === 1 && rd(4) === 0xffff && rd(8) === 0xffff && rd(14) === 0xffff &&
    d.subarray(rd(6), rd(6) + 33).equals(pk33) &&
    d.subarray(rd(2), rd(2) + 64).equals(raw) &&
    d.subarray(rd(10), rd(10) + rd(12)).equals(msg));
}

try {
  await card.verifyPin("1234");
  await card.sign(buildMessage(TAG_WITHDRAW, vault, to, 5_000_000_000n, 9n));
  ok("5 SOL over default limit is refused", false);
} catch (e) {
  ok("5 SOL over default limit is refused by the card", e instanceof CardError && e.sw === 0x6985);
}

close();
console.log(`\nALL ${n} CHECKS PASSED`);
