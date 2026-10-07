// P-256 helpers: convert what the card returns into what Solana's
// secp256r1 precompile expects.

const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
const HALF_N = N >> 1n;

/** 65-byte uncompressed point (04||X||Y) -> 33-byte compressed (02/03||X). */
export function compressPubkey(w: Buffer): Buffer {
  if (w.length !== 65 || w[0] !== 0x04) throw new Error("expected uncompressed P-256 point");
  const prefix = (w[64] & 1) === 0 ? 0x02 : 0x03;
  return Buffer.concat([Buffer.from([prefix]), w.subarray(1, 33)]);
}

/** DER ECDSA signature -> 64 bytes r||s with low-S (the precompile rejects high-S). */
export function derToRawLowS(der: Buffer): Buffer {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER: no SEQUENCE");
  i += der[i] & 0x80 ? 1 + (der[i] & 0x7f) : 1; // skip length
  const readInt = (): bigint => {
    if (der[i++] !== 0x02) throw new Error("bad DER: no INTEGER");
    const len = der[i++];
    const v = BigInt("0x" + der.subarray(i, i + len).toString("hex"));
    i += len;
    return v;
  };
  const r = readInt();
  let s = readInt();
  if (s > HALF_N) s = N - s;
  return Buffer.concat([toBytes32(r), toBytes32(s)]);
}

function toBytes32(v: bigint): Buffer {
  const hex = v.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("integer too large");
  return Buffer.from(hex, "hex");
}
