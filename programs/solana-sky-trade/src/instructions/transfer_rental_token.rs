use anchor_lang::prelude::*;
use mpl_bubblegum::types::MetadataArgs;

use crate::state::*;
use crate::{errors::*, LeafData};

use mpl_bubblegum::{
    hash::{hash_creators, hash_metadata},
    instructions::TransferCpiBuilder,
    types::LeafSchema,
    utils::get_asset_id,
};

#[derive(Accounts)]
pub struct TransferRentalTokenPayload<'info> {
    #[account(
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Account<'info, Data>,

    #[account(mut)]
    pub centralized_account: Signer<'info>,

    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub rental_merkle_tree: AccountInfo<'info>,

    /// CHECK: This account is checked in the instruction
    pub receiver: AccountInfo<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub bubblegum_program: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub compression_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_transfer_rental_token<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferRentalTokenPayload<'info>>,
    leaf_data: LeafData,
) -> Result<()> {
    if leaf_data.owner != ctx.accounts.sender.key() {
        return err!(MyError::InvalidLandNFTData);
    }

    if ctx.accounts.central_authority.merkle_tree_address != ctx.accounts.rental_merkle_tree.key() {
        return err!(MyError::InvalidRentalAddressPassed);
    }

    let bump_seed = [ctx.bumps.central_authority];
    let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

    let metadata = MetadataArgs::try_from_slice(leaf_data.leaf_metadata.as_slice())?;

    let data_hash = hash_metadata(&metadata)?;
    let creator_hash = hash_creators(&metadata.creators);

    let asset_id = get_asset_id(
        ctx.accounts.rental_merkle_tree.key,
        leaf_data.leaf_nonce.into(),
    );

    let schema = LeafSchema::V1 {
        id: asset_id,
        owner: leaf_data.owner,
        delegate: leaf_data.delegate,
        nonce: leaf_data.leaf_nonce.into(),
        data_hash: data_hash,
        creator_hash: creator_hash,
    };

    if schema.hash() != leaf_data.leaf_hash.unwrap() {
        return err!(MyError::InvalidLandNFTData);
    }

    let accounts = &mut ctx.remaining_accounts.iter();

    let mut proofs = Vec::new();

    for account in accounts.into_iter() {
        proofs.push((account, false, false));
    }

    TransferCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .leaf_owner(&ctx.accounts.sender.to_account_info(), true)
        .leaf_delegate(&ctx.accounts.centralized_account.to_account_info(), false)
        .new_leaf_owner(&ctx.accounts.receiver.to_account_info())
        .merkle_tree(&ctx.accounts.rental_merkle_tree.to_account_info())
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .root(leaf_data.root.to_bytes())
        .data_hash(data_hash)
        .creator_hash(creator_hash)
        .nonce(leaf_data.leaf_nonce)
        .index(leaf_data.leaf_index)
        .add_remaining_accounts(&proofs)
        .invoke_signed(signer_seeds)?;

    Ok(())
}
