//! CardVault: SOL vault that needs TWO signatures to move funds:
//!   1. the owner's normal Solana key (e.g. Phantom, Ed25519) as tx signer
//!   2. a P-256 signature from the Java Card, verified by Solana's
//!      secp256r1 precompile in the instruction right before ours.
//! A recovery card can rotate the owner if the Phantom key is lost/stolen.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

declare_id!("F2G3Mh1mBGSCaoZqCpV4Tqj95SpUQa2R96DmjX3uMKQ4");

/// Native secp256r1 (P-256) signature verification program (SIMD-0075).
pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");

pub const TAG_WITHDRAW: u8 = 0x01;
pub const TAG_RECOVER: u8 = 0x02;
pub const MSG_LEN: usize = 81;
pub const CARD_PUBKEY_LEN: usize = 33; // compressed P-256 point

#[program]
pub mod card_vault {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        card: [u8; CARD_PUBKEY_LEN],
        recovery_card: [u8; CARD_PUBKEY_LEN],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.creator = ctx.accounts.owner.key();
        vault.owner = ctx.accounts.owner.key();
        vault.card = card;
        vault.recovery_card = recovery_card;
        vault.nonce = 0;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// Needs: owner signature (tx signer) + main card signature (precompile).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault_key = ctx.accounts.vault.key();
        let vault = &ctx.accounts.vault;

        let msg = build_message(
            TAG_WITHDRAW,
            &vault_key,
            &ctx.accounts.recipient.key(),
            amount,
            vault.nonce,
        );
        verify_card_signature(&ctx.accounts.instructions, &vault.card, &msg)?;

        // Keep the vault rent-exempt.
        let vault_info = ctx.accounts.vault.to_account_info();
        let min_balance = Rent::get()?.minimum_balance(vault_info.data_len());
        let available = vault_info.lamports().saturating_sub(min_balance);
        require!(amount <= available, VaultError::InsufficientFunds);

        vault_info.sub_lamports(amount)?;
        ctx.accounts.recipient.add_lamports(amount)?;

        let vault = &mut ctx.accounts.vault;
        vault.nonce = vault.nonce.checked_add(1).ok_or(VaultError::Overflow)?;
        Ok(())
    }

    /// Needs ONLY the recovery card signature: rotates the owner key
    /// (e.g. after Phantom was compromised). Anyone may pay the fee.
    pub fn recover(ctx: Context<Recover>, new_owner: Pubkey) -> Result<()> {
        let vault_key = ctx.accounts.vault.key();
        let vault = &ctx.accounts.vault;

        let msg = build_message(TAG_RECOVER, &vault_key, &new_owner, 0, vault.nonce);
        verify_card_signature(&ctx.accounts.instructions, &vault.recovery_card, &msg)?;

        let vault = &mut ctx.accounts.vault;
        vault.owner = new_owner;
        vault.nonce = vault.nonce.checked_add(1).ok_or(VaultError::Overflow)?;
        Ok(())
    }
}

/// tag(1) | vault(32) | target(32) | amount u64 LE (8) | nonce u64 LE (8)
/// Must match the layout parsed by the Java Card applet.
pub fn build_message(
    tag: u8,
    vault: &Pubkey,
    target: &Pubkey,
    amount: u64,
    nonce: u64,
) -> [u8; MSG_LEN] {
    let mut m = [0u8; MSG_LEN];
    m[0] = tag;
    m[1..33].copy_from_slice(vault.as_ref());
    m[33..65].copy_from_slice(target.as_ref());
    m[65..73].copy_from_slice(&amount.to_le_bytes());
    m[73..81].copy_from_slice(&nonce.to_le_bytes());
    m
}

/// Checks that the previous instruction is a secp256r1 precompile call that
/// verified exactly (expected_pubkey, expected_msg). The precompile itself
/// fails the whole transaction if the signature is invalid, so here we only
/// need to make sure it checked the RIGHT key and the RIGHT message.
fn verify_card_signature(
    ix_sysvar: &AccountInfo,
    expected_pubkey: &[u8; CARD_PUBKEY_LEN],
    expected_msg: &[u8],
) -> Result<()> {
    let current = load_current_index_checked(ix_sysvar)?;
    require!(current > 0, VaultError::MissingCardSignature);
    let ix = load_instruction_at_checked((current - 1) as usize, ix_sysvar)?;
    require_keys_eq!(ix.program_id, SECP256R1_PROGRAM_ID, VaultError::MissingCardSignature);

    // Layout: num_signatures u8 | padding u8 | 7 x u16 offsets | data...
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, VaultError::BadSigInstruction);
    let rd = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let sig_ix = rd(4);
    let pk_off = rd(6) as usize;
    let pk_ix = rd(8);
    let msg_off = rd(10) as usize;
    let msg_len = rd(12) as usize;
    let msg_ix = rd(14);

    // u16::MAX = data lives inside the precompile instruction itself.
    // Otherwise an attacker could point the precompile at other data.
    require!(
        sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
        VaultError::BadSigInstruction
    );

    let pk = d
        .get(pk_off..pk_off + CARD_PUBKEY_LEN)
        .ok_or(VaultError::BadSigInstruction)?;
    require!(pk == expected_pubkey.as_slice(), VaultError::WrongCard);

    let msg = d
        .get(msg_off..msg_off + msg_len)
        .ok_or(VaultError::BadSigInstruction)?;
    require!(msg == expected_msg, VaultError::WrongMessage);
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.creator.as_ref()],
        bump = vault.bump,
        has_one = owner
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: any account can receive lamports; it is bound by the card signature.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar, address is checked.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Recover<'info> {
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", vault.creator.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: instructions sysvar, address is checked.
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub creator: Pubkey, // used for the PDA seed, never changes
    pub owner: Pubkey,   // Phantom key; can be rotated by the recovery card
    pub card: [u8; CARD_PUBKEY_LEN],
    pub recovery_card: [u8; CARD_PUBKEY_LEN],
    pub nonce: u64,
    pub bump: u8,
}

#[error_code]
pub enum VaultError {
    #[msg("Previous instruction must be a secp256r1 signature check")]
    MissingCardSignature,
    #[msg("Malformed secp256r1 instruction")]
    BadSigInstruction,
    #[msg("Signature is from the wrong card")]
    WrongCard,
    #[msg("Card signed a different message")]
    WrongMessage,
    #[msg("Not enough funds in the vault")]
    InsufficientFunds,
    #[msg("Arithmetic overflow")]
    Overflow,
}
