use crate::{errors::*, state::*};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

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

    pub mint_account: Account<'info, Mint>,
}

#[derive(Debug, Clone, AnchorDeserialize, AnchorSerialize)]
pub struct UpdateConfigData {
    pub base_cost: Option<f64>,
    pub admin_quota: Option<f64>,
    pub auction_house_address: Option<Pubkey>,
    pub multiplier: Option<f64>,
    pub fee_account: Option<Pubkey>,
    pub mint_address: Option<Pubkey>,
    pub royalties_receiver: Option<Pubkey>,
    pub mint_creator: Option<Pubkey>,
    pub verification_creator: Option<Pubkey>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfigPayload>,
    payload: UpdateConfigData,
) -> Result<()> {
    if ctx.accounts.central_authority.centralized_account != ctx.accounts.centralized_account.key()
    {
        return err!(CustomErrors::InvalidAuthority);
    }

    match payload.base_cost {
        Some(value) => {
            ctx.accounts.central_authority.base_cost =
                (value * f64::powf(10.0, ctx.accounts.mint_account.decimals.into())) as u64;
        }
        None => {}
    }

    match payload.admin_quota {
        Some(value) => {
            ctx.accounts.central_authority.admin_quota = value;
        }
        None => {}
    }

    match payload.auction_house_address {
        Some(value) => {
            ctx.accounts.central_authority.auction_house_address = value;
        }
        None => {}
    }
    match payload.mint_address {
        Some(value) => {
            ctx.accounts.central_authority.mint_address = value;
        }
        None => {}
    }

    match payload.fee_account {
        Some(value) => ctx.accounts.central_authority.fee_account = value,
        None => {}
    }

    if let Some(royalties_receiver) = payload.royalties_receiver {
        ctx.accounts.central_authority.creators.royalties_receiver = royalties_receiver;
    }
    if let Some(mint_creator) = payload.mint_creator {
        ctx.accounts.central_authority.creators.mint_creator = mint_creator;
    }
    if let Some(verification_creator) = payload.verification_creator {
        ctx.accounts.central_authority.creators.verification_creator = verification_creator;
    }

    Ok(())
}
