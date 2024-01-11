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

#[derive(Debug, Clone, AnchorDeserialize, AnchorSerialize)]
pub struct UpdateConfigData {
    pub base_cost: Option<u64>,
    pub admin_quota: Option<f64>,
    pub merkle_tree_address: Option<Pubkey>,
    pub multiplier: Option<f64>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfigPayload>,
    payload: UpdateConfigData,
) -> Result<()> {
    if ctx.accounts.central_authority.centralized_account != ctx.accounts.centralized_account.key()
    {
        return err!(MyError::InvalidAuthority);
    }

    match payload.base_cost {
        Some(value) => {
            ctx.accounts.central_authority.base_cost = value * u64::pow(10, 6);
        }
        None => {}
    }

    match payload.admin_quota {
        Some(value) => {
            ctx.accounts.central_authority.admin_quota = value;
        }
        None => {}
    }

    match payload.merkle_tree_address {
        Some(value) => {
            ctx.accounts.central_authority.merkle_tree_address = value;
        }
        None => {}
    }

    match payload.multiplier {
        Some(value) => {
            ctx.accounts.central_authority.multiplier = value;
        }
        None => {}
    }

    Ok(())
}
