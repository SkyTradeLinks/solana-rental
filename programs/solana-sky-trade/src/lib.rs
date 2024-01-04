use anchor_lang::prelude::*;

use chrono::{DateTime, FixedOffset};

declare_id!("4KMuY3t3GfGHCzp94yC3QYV2bmzqKYNSdQjS8SxxJ7Zp");

#[program]
pub mod solana_sky_trade {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, land_ids: String) -> Result<()> {
        // let bump_seed = [ctx.bumps.central_authority];
        // let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

        // emit!();

        // ctx.accounts.central_authority.

        // ctx.accounts

        // ctx.accounts.central_authority

        // note_pda_account

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(land_ids: String)]
pub struct Initialize<'info> {
    // #[account(
    //     init_if_needed,
    //     payer = payer,
    //     space = 8 + CentralStateData::MAX_SIZE,
    //     seeds = [b"central_authority"],
    //     bump
    //     )]
    // pub central_authority: Account<'info, CentralStateData>,
    #[
        account(
            init_if_needed,
            payer = payer,
            space = 8 + Data::MAX_SIZE,
            seeds = [b"test_seed"],
            bump
        )
    ]
    pub pda: Account<'info, Data>,

    #[account(mut, signer)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct CentralStateData {
    pub initialized: bool,           // 1
    pub centralized_account: Pubkey, //32
    pub base_cost: u64,              // 8
    pub admin_quota: f64,            // 8
}

impl CentralStateData {
    pub const MAX_SIZE: usize = (1 + 32 + 8 + 8) * 3;
}

#[account]
pub struct Data {
    // pub asset_id: Vec<Pubkey>, // 32 * 10
    // pub start_time: DateTime<FixedOffset>,
    // pub end_time: DateTime<FixedOffset>,
    pub is_initialized: bool,
}

impl Data {
    pub const MAX_SIZE: usize = 2;
}
