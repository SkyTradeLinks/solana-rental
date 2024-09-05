use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::errors::*;

use crate::state::*;

#[derive(Accounts)]
pub struct InitializePayload<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Data::MAX_SIZE,
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Account<'info, Data>,

    #[account(mut, signer)]
    pub payer: Signer<'info>,

    /// CHECK: This account is checked in the instruction
    pub fee_account: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    pub mint_account: InterfaceAccount<'info, Mint>,
}

pub fn handle_initialize(ctx: Context<InitializePayload>) -> Result<()> {
    if ctx.accounts.central_authority.initialized {
        return err!(MyError::AlreadyInitialized);
    }

    let data = &mut ctx.accounts.central_authority;

    // Account That Signs Every Single Tx
    data.centralized_account = ctx.accounts.payer.key();
    data.initialized = true;

    // 1 USDC
    data.base_cost = 1 * u64::pow(10, ctx.accounts.mint_account.decimals as u32);

    // Admin Quota: 30%
    data.admin_quota = 0.3;

    // Fee Account
    data.fee_account = ctx.accounts.fee_account.key();

    Ok(())
}
