use crate::{errors::*, state::*};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateConfigPayload<'info> {
    #[account(
        mut,
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Account<'info, Data>,

    #[account(mut)]
    pub centralized_account: Signer<'info>,

    pub system_program: Program<'info, System>,
}


// 1 + (0.1 * 5)

pub fn handle_update_config(
    ctx: Context<UpdateConfigPayload>,
    base_cost: Option<u64>,
    admin_quota: Option<f64>,
) -> Result<()> {
    if ctx.accounts.central_authority.centralized_account != ctx.accounts.centralized_account.key()
    {
        return err!(MyError::InvalidAuthority);
    }

    match base_cost {
        Some(value) => {
            ctx.accounts.central_authority.base_cost = value * u64::pow(10, 6);
        }
        None => {}
    }

    match admin_quota {
        Some(value) => {
            ctx.accounts.central_authority.admin_quota = value;
        }
        None => {}
    }

    Ok(())
}
