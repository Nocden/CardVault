// Builds the on-chain instructions for the card_vault program without an IDL,
// so the client works before `anchor build` has been run.
import { createHash } from "node:crypto";
import {
  Connection, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, TransactionInstruction,
} from "@solana/web3.js";

// Replace after `anchor keys sync` / deploy (or set CARD_VAULT_PROGRAM_ID).
export const PROGRAM_ID = new PublicKey(
  process.env.CARD_VAULT_PROGRAM_ID ?? "F2G3Mh1mBGSCaoZqCpV4Tqj95SpUQa2R96DmjX3uMKQ4",
);
export const SECP256R1_PROGRAM_ID = new PublicKey("Secp256r1SigVerify1111111111111111111111111");

export const TAG_WITHDRAW = 0x01;
export const TAG_RECOVER = 0x02;

const disc = (s: string) => createHash("sha256").update(s).digest().subarray(0, 8);

export function vaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), creator.toBuffer()], PROGRAM_ID)[0];
}

/** tag(1) | vault(32) | target(32) | amount u64 LE | nonce u64 LE  = 81 bytes */
export function buildMessage(tag: number, vault: PublicKey, target: PublicKey, amount: bigint, nonce: bigint): Buffer {
  const m = Buffer.alloc(81);
  m[0] = tag;
  vault.toBuffer().copy(m, 1);
  target.toBuffer().copy(m, 33);
  m.writeBigUInt64LE(amount, 65);
  m.writeBigUInt64LE(nonce, 73);
  return m;
}

/** secp256r1 precompile instruction with all data inline (indexes = 0xFFFF). */
export function secp256r1Instruction(pubkey33: Buffer, sig64: Buffer, message: Buffer): TransactionInstruction {
  const pkOff = 16, sigOff = pkOff + 33, msgOff = sigOff + 64;
  const data = Buffer.alloc(msgOff + message.length);
  data[0] = 1; // num signatures
  data[1] = 0; // padding
  data.writeUInt16LE(sigOff, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pkOff, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(msgOff, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  pubkey33.copy(data, pkOff);
  sig64.copy(data, sigOff);
  message.copy(data, msgOff);
  return new TransactionInstruction({ programId: SECP256R1_PROGRAM_ID, keys: [], data });
}

export function initializeIx(owner: PublicKey, card33: Buffer, recovery33: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda(owner), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("global:initialize"), card33, recovery33]),
  });
}

export function withdrawIx(owner: PublicKey, vault: PublicKey, recipient: PublicKey, amount: bigint): TransactionInstruction {
  const a = Buffer.alloc(8); a.writeBigUInt64LE(amount);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("global:withdraw"), a]),
  });
}

export function recoverIx(payer: PublicKey, vault: PublicKey, newOwner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc("global:recover"), newOwner.toBuffer()]),
  });
}

export interface VaultState {
  creator: PublicKey; owner: PublicKey; card: Buffer; recoveryCard: Buffer; nonce: bigint; bump: number;
}

export function decodeVault(data: Buffer): VaultState {
  if (!data.subarray(0, 8).equals(disc("account:Vault"))) throw new Error("not a Vault account");
  let o = 8;
  const creator = new PublicKey(data.subarray(o, (o += 32)));
  const owner = new PublicKey(data.subarray(o, (o += 32)));
  const card = Buffer.from(data.subarray(o, (o += 33)));
  const recoveryCard = Buffer.from(data.subarray(o, (o += 33)));
  const nonce = data.readBigUInt64LE(o); o += 8;
  return { creator, owner, card, recoveryCard, nonce, bump: data[o] };
}

export async function fetchVault(conn: Connection, vault: PublicKey): Promise<VaultState> {
  const acc = await conn.getAccountInfo(vault);
  if (!acc) throw new Error(`vault ${vault.toBase58()} not found`);
  return decodeVault(acc.data);
}
