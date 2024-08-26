use anchor_lang::{accounts::signer, prelude::*};
use mpl_bubblegum::accounts;
use std::mem::size_of;
use anchor_spl::{
    associated_token::{ AssociatedToken, Create},
    token::{transfer_checked, Mint, Token, TokenAccount,Transfer, TransferChecked,transfer},
};
use crate::state::{RentEscrow,Data};
#[derive(Accounts)]
#[instruction(land_asset_id:Pubkey,creation_time:String)]
pub struct TransferOnExpiryAccounts<'info>{
    #[account(mut)]
    payer:Signer<'info>,
    #[account(mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
        )]    
    payer_ata: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    system_program:Program<'info,System>,

/// CHECK: checked at ix
    pub fee_account: UncheckedAccount<'info>,
    
    
    #[account(
        mut,
         associated_token::mint = mint,
         associated_token::authority = fee_account,
         )]
     
         fee_account_ata: Box<Account<'info, TokenAccount>>, 

         /// CHECK: checked at ix
         land_owner:UncheckedAccount<'info>,
         
          #[account(
           mut,
            associated_token::mint = mint,
            associated_token::authority = land_owner,
            )]
        
            land_owner_ata: Box<Account<'info, TokenAccount>>, 
   
    #[account(
        mut,
        seeds=[
            land_asset_id.key().as_ref(),
            creation_time.as_ref()
        ],
        bump
    )]
     rent_escrow:Account<'info,RentEscrow>,
     
      #[account(
       mut,
        associated_token::mint = mint,
        associated_token::authority = rent_escrow,
        )]
    
        rent_escrow_ata: Box<Account<'info, TokenAccount>>, 

} 

impl <'info> TransferOnExpiryAccounts<'info> {
    
    fn transfer_feeAta_ctx(&self) -> CpiContext<'_, '_, '_, 'info,Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.rent_escrow_ata.to_account_info(),
                to: self.fee_account_ata.to_account_info(),
                authority: self.rent_escrow.to_account_info(),
            },
        )
    }

    fn transfer_owner_ctx(&self) -> CpiContext<'_, '_, '_, 'info,Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.rent_escrow_ata.to_account_info(),
                to: self.land_owner_ata.to_account_info(),
                authority: self.rent_escrow.to_account_info(),
            },
        )
    }
}

pub fn handle_transfer_on_expiry<'info>(ctx:Context<'_, '_, '_, 'info,TransferOnExpiryAccounts<'info>>,land_asset_id:Pubkey,creation_time:String,bump:u32)->Result<()> {  
    let  expected_cost=ctx.accounts.rent_escrow.expected_cost; 
    let fee_quota=ctx.accounts.rent_escrow.fee_quota;
    
    msg!("espected cost {}",expected_cost);
    msg!("feequota {}",fee_quota);
    
     transfer(
        ctx.accounts
            .transfer_feeAta_ctx()
            .with_signer(&[&ctx.accounts.rent_escrow.escrow_seeds()]),
            fee_quota,
        
    )?; 
    let land_owner=expected_cost-fee_quota;
    transfer(
        ctx.accounts
            .transfer_owner_ctx()
            .with_signer(&[&ctx.accounts.rent_escrow.escrow_seeds()]),
            land_owner,
        
    )?; 
     


    
    Ok(())
}