use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{create, get_associated_token_address, AssociatedToken, Create},
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use mpl_bubblegum::{instructions::MintToCollectionV1CpiBuilder, types::MetadataArgs};

use crate::{errors::*, state::*, LeafData};

#[derive(Accounts)]
pub struct MintRentalTokenPayload<'info> {
    #[account(
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Box<Account<'info, Data>>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub centralized_account: Signer<'info>,

    #[account(
        init_if_needed,
        payer = centralized_account,
        associated_token::mint = mint,
        associated_token::authority = centralized_account
    )]
    pub centralized_account_ata: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = caller
    )]
    pub caller_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub rental_merkle_tree: AccountInfo<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    // pub land_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub collection_mint: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK: This account is checked in the instruction
    pub collection_metadata: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub collection_edition: UncheckedAccount<'info>,

    /// CHECK: used to sign creation
    pub bubblegum_signer: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub fee_account_ata: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub bubblegum_program: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub compression_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,

    /// CHECK: This account is checked in the instruction
    pub token_metadata_program: UncheckedAccount<'info>,
}

pub fn handle_mint_rental_token<'info>(
    ctx: Context<'_, '_, '_, 'info, MintRentalTokenPayload<'info>>,
    mint_metadata_args: Vec<u8>,
    leaves_data: Vec<LeafData>,
) -> Result<()> {
    // let bump_seed = [ctx.bumps.central_authority];
    // let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

    if ctx.accounts.central_authority.centralized_account != ctx.accounts.centralized_account.key()
    {
        return err!(MyError::InvalidAuthority);
    }

    let expected_fee_ata = get_associated_token_address(
        &ctx.accounts.central_authority.fee_account,
        &ctx.accounts.mint.key(),
    );

    if expected_fee_ata != ctx.accounts.fee_account_ata.key() {
        return err!(MyError::InvalidAuthority);
    }

    let expected_cost = ctx.accounts.central_authority.base_cost * leaves_data.len() as u64;

    if ctx.accounts.caller_ata.amount < expected_cost {
        return err!(MyError::InsuffientFunds);
    }

    let mut nft_atas: Vec<AccountInfo> = Vec::new();
    let accounts = &mut ctx.remaining_accounts.iter();

    if accounts.len() == 0 || accounts.len() % 2 != 0 {
        return err!(MyError::InvalidRemainingAccountsPassed);
    }

    let length: usize = accounts.len() / 2;

    if leaves_data.len() == 0 || leaves_data.len() != length {
        return err!(MyError::InvalidLandNFTData);
    }

    for index in 0..length {
        let land_owner = next_account_info(accounts)?;
        let land_owner_ata = next_account_info(accounts)?;

        let expected_ata = get_associated_token_address(land_owner.key, &ctx.accounts.mint.key());

        let leaf_data = &leaves_data[index];

        if land_owner_ata.key() != expected_ata || leaf_data.owner != land_owner.key() {
            return err!(MyError::InvalidLandNFTData);
        }

        // let asset_id = get_asset_id(
        //     ctx.accounts.land_merkle_tree.key,
        //     leaf_data.leaf_nonce.into(),
        // );

        // let metadata = MetadataArgs::try_from_slice(leaf_data.leaf_metadata.as_slice())?;

        // let data_hash = hash_metadata(&metadata)?;
        // let creator_hash = hash_creators(&metadata.creators);

        // let schema = LeafSchema::V1 {
        //     id: asset_id,
        //     owner: leaf_data.owner,
        //     delegate: leaf_data.delegate,
        //     nonce: leaf_data.leaf_nonce,
        //     data_hash: data_hash,
        //     creator_hash: creator_hash,
        // };

        // if schema.hash() != leaf_data.leaf_hash.unwrap() {
        //     return err!(MyError::InvalidLandNFTData);
        // }

        if **land_owner_ata.try_borrow_lamports().unwrap() == 0 {
            let _ = create(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                Create {
                    payer: ctx.accounts.centralized_account.to_account_info(),
                    associated_token: land_owner_ata.to_account_info(),
                    authority: land_owner.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ));
        }

        nft_atas.push(land_owner_ata.to_account_info());
    }

    let decimals = ctx.accounts.mint.decimals;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.caller_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.centralized_account_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        expected_cost,
        decimals,
    )?;

    let percent = (1 as f64 - ctx.accounts.central_authority.admin_quota) / nft_atas.len() as f64;
    let quota = percent * (expected_cost as f64);
    let quota = quota as u64;

    // Transfer To Land Owner
    for ata in nft_atas.iter() {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.centralized_account_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ata.to_account_info(),
                    authority: ctx.accounts.centralized_account.to_account_info(),
                },
            ),
            quota,
            decimals,
        )?;
    }

    let fee_quota = ctx.accounts.central_authority.admin_quota * (expected_cost as f64);
    let fee_quota = fee_quota as u64;

    // Transfer To Fee Account
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.centralized_account_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.fee_account_ata.to_account_info(),
                authority: ctx.accounts.centralized_account.to_account_info(),
            },
        ),
        fee_quota,
        decimals,
    )?;

    let mint_metadata = MetadataArgs::try_from_slice(mint_metadata_args.as_slice())?;

    MintToCollectionV1CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
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

    Ok(())
}
