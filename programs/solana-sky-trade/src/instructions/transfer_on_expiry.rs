use crate::{Auction, LeafData, RentEscrow, SplAccountCompressionProgramAccount, Data};
use anchor_lang::{prelude::*, solana_program::system_program};
use chrono::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer, Mint, Token, TokenAccount, Transfer, CloseAccount, self},
};
use mpl_bubblegum::{
    instructions::{VerifyLeafCpi, VerifyLeafCpiAccounts, VerifyLeafInstructionArgs},
    types::LeafSchema,
    utils::get_asset_id,
};

use crate::errors::*;

#[derive(Accounts)]
pub struct TransferOnExpiryAccounts<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Box<Account<'info, Data>>,

    /// CHECK: checked at ix
    #[account(mut,
    )]
    pub fee_account: UncheckedAccount<'info>,
    #[account(
        mut,
         associated_token::mint = mint,
         associated_token::authority = fee_account,
         )]
    fee_account_ata: Account<'info, TokenAccount>,

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
    payment_receiver_ata: Account<'info, TokenAccount>,

    #[account(mut, 
        close = fee_account,
    )]
    rent_escrow: Account<'info, RentEscrow>,

    #[account(
       mut,
        associated_token::mint = mint,
        associated_token::authority = rent_escrow,
    )]
    rent_escrow_ata: Account<'info, TokenAccount>,
    /// CHECK: Don't need to check
    merkle_tree: AccountInfo<'info>,

    pub compression_program: Program<'info, SplAccountCompressionProgramAccount>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
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

    fn close_ata_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            CloseAccount {
                account: self.rent_escrow_ata.to_account_info(),
                destination: self.fee_account.to_account_info(),
                authority: self.rent_escrow.to_account_info(),
            },
        )
    }
}

pub fn handle_transfer_on_expiry<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferOnExpiryAccounts<'info>>,
    leaf_data: LeafData,
) -> Result<()> {
    
    if ctx.accounts.fee_account.key() != ctx.accounts.central_authority.fee_account {
        return err!(CustomErrors::InvalidReceiver);
    }


    let mint_pubkey=ctx.accounts.mint.key();
    if mint_pubkey != ctx.accounts.central_authority.mint_address {
        return err!(CustomErrors::InvalidMint);
    }
    let expiration_time=DateTime::parse_from_rfc3339(&ctx.accounts.rent_escrow.end_time).unwrap();
    let expiration_timestamp=expiration_time.timestamp(); 
    let current_timestamp=Clock::get().unwrap().unix_timestamp; 
     if expiration_timestamp > current_timestamp {
        return err!(CustomErrors::InvalidTransferTime);
    } 

    let escrow = &ctx.accounts.rent_escrow;

    let expected_cost = escrow.expected_cost;
    let fee_quota = escrow.fee_quota;

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
    
    require_keys_eq!(ctx.accounts.rent_escrow.land_asset_id, asset_id);

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
        if ctx.accounts.land_owner.key() != ctx.accounts.payment_receiver.key() {
            return err!(CustomErrors::InvalidReceiver);
        }
    } else if ctx.accounts.land_owner.owner.key()
        == ctx.accounts.central_authority.auction_house_address.key()
    {
        let mut auction_data: &[u8] = &ctx.accounts.land_owner.data.borrow();

        let auction = Auction::try_deserialize(&mut auction_data)?;
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
            .with_signer(&[&escrow.escrow_seeds()]),
        fee_quota,
    )?;
    let final_payment = expected_cost - fee_quota;
    transfer(
        ctx.accounts
            .transfer_receiver_ctx()
            .with_signer(&[&escrow.escrow_seeds()]),
        final_payment,
    )?;

    // close offer ata
    token::close_account(
        ctx.accounts
            .close_ata_context()
            .with_signer(&[&escrow.escrow_seeds()]),
    )?;

    Ok(())
}
