use anchor_lang::prelude::*;
use chrono::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};
use mpl_bubblegum::{instructions::MintToCollectionV1CpiBuilder, types::MetadataArgs};
use mpl_token_metadata::ID;

use crate::state::*;

#[derive(Clone)]
pub struct Metadata;

impl anchor_lang::Id for Metadata {
    fn id() -> Pubkey {
        ID
    }
}

#[derive(Accounts)]
#[instruction(land_asset_id:Pubkey,creation_time:String)]
pub struct MintRentalTokenPayload<'info> {
    #[account(
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Box<Account<'info, Data>>,

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub centralized_account: Signer<'info>,

    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut,
        associated_token::mint = mint,
        associated_token::authority = caller
    )]
    pub caller_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer=centralized_account,
        space=RentEscrow::MAX_SIZE +usize::from(4+creation_time.len()),
        seeds=[
            b"escrow",
            land_asset_id.key().as_ref(),
            creation_time.as_ref()
        ],
        bump
    )]
    rent_escrow: Account<'info, RentEscrow>,

    #[account(
        init,
        payer=centralized_account,
        associated_token::mint = mint,
        associated_token::authority = rent_escrow,
        )]
    rent_escrow_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub rental_merkle_tree: AccountInfo<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub land_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub collection_mint: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub collection_edition: UncheckedAccount<'info>,

    /// CHECK: used to sign creation
    pub bubblegum_signer: UncheckedAccount<'info>,

    pub bubblegum_program: Program<'info, MplBubblegumProgramAccount>,
    pub log_wrapper: Program<'info, NoopProgramAccount>,
    pub compression_program: Program<'info, SplAccountCompressionProgramAccount>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
}

pub fn handle_mint_rental_token<'info>(
    ctx: Context<'_, '_, '_, 'info, MintRentalTokenPayload<'info>>,
    land_asset_id: Pubkey,
    creation_time: String,
    bump: u8,
    mint_metadata_args: Vec<u8>,
    leaves_data: u64,
) -> Result<()> {
    let expected_cost = ctx.accounts.central_authority.base_cost * leaves_data as u64;

    let decimals = ctx.accounts.mint.decimals;

    let fee_quota = ctx.accounts.central_authority.admin_quota * (expected_cost as f64);
    let fee_quota = fee_quota as u64;

    let mint_metadata = MetadataArgs::try_from_slice(mint_metadata_args.as_slice())?;

    ctx.accounts.rent_escrow.land_asset_id = land_asset_id;
    ctx.accounts.rent_escrow.creation_time = creation_time;
    ctx.accounts.rent_escrow.escrow_bump = [bump];
    ctx.accounts.rent_escrow.expected_cost = expected_cost;
    ctx.accounts.rent_escrow.fee_quota = fee_quota;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.caller_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.rent_escrow_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        expected_cost,
        decimals,
    )?;

    msg!("decimal {}", decimals);
    msg!("expected cost {}", expected_cost);
    let ans = MintToCollectionV1CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .leaf_owner(&ctx.accounts.caller.to_account_info())
        .leaf_delegate(&ctx.accounts.centralized_account.to_account_info())
        .merkle_tree(&ctx.accounts.rental_merkle_tree.to_account_info())
        .payer(&ctx.accounts.centralized_account.to_account_info())
        .tree_creator_or_delegate(&ctx.accounts.centralized_account.to_account_info())
        .collection_authority(&ctx.accounts.centralized_account.to_account_info())
        .collection_mint(&ctx.accounts.collection_mint.to_account_info())
        .collection_metadata(&ctx.accounts.collection_metadata.to_account_info())
        .collection_edition(&ctx.accounts.collection_edition.to_account_info())
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .bubblegum_signer(&ctx.accounts.bubblegum_signer.to_account_info())
        .token_metadata_program(&ctx.accounts.token_metadata_program.to_account_info())
        .metadata(mint_metadata)
        .invoke()?;
    // .invoke_signed(signer_seeds)?;
    msg!("ans {:?}", ans);

    Ok(())
}
