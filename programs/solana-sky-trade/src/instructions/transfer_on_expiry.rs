use crate::{Auction, LeafData, RentEscrow, SplAccountCompressionProgramAccount};
use anchor_lang::{prelude::*, solana_program::system_program};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer},
};
use mpl_bubblegum::{
    instructions::{VerifyLeafCpi, VerifyLeafCpiAccounts, VerifyLeafInstructionArgs},
    types::LeafSchema,
    utils::get_asset_id,
};

use crate::errors::*;

#[derive(Accounts)]
#[instruction(land_asset_id:Pubkey,creation_time:String)]
pub struct TransferOnExpiryAccounts<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
        )]
    payer_ata: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    system_program: Program<'info, System>,

    /// CHECK: checked at ix
    pub fee_account: UncheckedAccount<'info>,

    #[account(
        mut,
         associated_token::mint = mint,
         associated_token::authority = fee_account,
         )]
    fee_account_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: checked at ix
    land_owner: UncheckedAccount<'info>,

    /// CHECK: checked at ix
    land_delegate: UncheckedAccount<'info>,

    /// CHECK: checked at ix
    payment_receiver: UncheckedAccount<'info>,

    #[account(
           mut,
            associated_token::mint = mint,
            associated_token::authority = payment_receiver,
            )]
    payment_receiver_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        seeds=[
            land_asset_id.key().as_ref(),
            creation_time.as_ref()
        ],
        bump
    )]
    rent_escrow: Account<'info, RentEscrow>,

    #[account(
       mut,
        associated_token::mint = mint,
        associated_token::authority = rent_escrow,
        )]
    rent_escrow_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: Don't need to check
    merkle_tree: AccountInfo<'info>,

    compression_program: Program<'info, SplAccountCompressionProgramAccount>,
}

impl<'info> TransferOnExpiryAccounts<'info> {
    fn transfer_fee_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.rent_escrow_ata.to_account_info(),
                to: self.fee_account_ata.to_account_info(),
                authority: self.rent_escrow.to_account_info(),
            },
        )
    }

    fn transfer_receiver_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.rent_escrow_ata.to_account_info(),
                to: self.payment_receiver_ata.to_account_info(),
                authority: self.rent_escrow.to_account_info(),
            },
        )
    }
}

pub fn handle_transfer_on_expiry<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferOnExpiryAccounts<'info>>,
    leaf_data: LeafData,
) -> Result<()> {
    let expected_cost = ctx.accounts.rent_escrow.expected_cost;
    let fee_quota = ctx.accounts.rent_escrow.fee_quota;

    msg!("espected cost {}", expected_cost);
    msg!("feequota {}", fee_quota);

    let asset_id = get_asset_id(&ctx.accounts.merkle_tree.key(), leaf_data.nonce);
    let leaf = LeafSchema::V1 {
        id: asset_id,
        owner: ctx.accounts.land_owner.key(),
        delegate: ctx.accounts.land_delegate.key(),
        nonce: leaf_data.nonce,
        data_hash: leaf_data.hash,
        creator_hash: leaf_data.creator_hash,
    };

    //This checks land_owner as owner
    VerifyLeafCpi::new(
        &ctx.accounts.compression_program.to_account_info(),
        VerifyLeafCpiAccounts {
            merkle_tree: &ctx.accounts.merkle_tree.to_account_info(),
        },
        VerifyLeafInstructionArgs {
            index: leaf_data.index,
            root: leaf_data.root,
            leaf: leaf.hash(),
        },
    )
    .invoke_with_remaining_accounts(
        ctx.remaining_accounts
            .iter()
            .map(|account| (account, false, false))
            .collect::<Vec<_>>()
            .as_slice(),
    )?;

    if ctx.accounts.land_owner.owner.key() == system_program::id().key() {
        msg!("Land not in auction");
        if ctx.accounts.land_owner.owner.key() != ctx.accounts.payment_receiver.key() {
            return err!(CustomErrors::InvalidReceiver);
        }
    } else if ctx.accounts.land_owner.owner.key().to_string()
        == "ahpDxBMbyGLzDXAT7zLDyDBhvhXHAQyAAQFZerA4phL"
    //TODO find a better way
    {
        let auction = Auction::try_from_slice(&ctx.accounts.land_owner.data.borrow())?;
        msg!("Land in auction. Auction creator is {}", auction.seller);

        if auction.seller.key() != ctx.accounts.payment_receiver.key() {
            return err!(CustomErrors::InvalidReceiver);
        }
    } else {
        return err!(CustomErrors::InvalidReceiver);
    }

    transfer(
        ctx.accounts
            .transfer_fee_ctx()
            .with_signer(&[&ctx.accounts.rent_escrow.escrow_seeds()]),
        fee_quota,
    )?;
    let land_owner = expected_cost - fee_quota;
    transfer(
        ctx.accounts
            .transfer_receiver_ctx()
            .with_signer(&[&ctx.accounts.rent_escrow.escrow_seeds()]),
        land_owner,
    )?;

    Ok(())
}
