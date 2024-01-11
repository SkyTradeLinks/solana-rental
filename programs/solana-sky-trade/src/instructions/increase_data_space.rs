use crate::state::*;
use anchor_lang::prelude::*;

    
#[derive(Accounts)]
#[instruction(len: u16)]
pub struct IncreaseDataSpacePayload<'info> {
    
    #[account(mut, 
        realloc = len as usize, 
        realloc::zero = true, 
        realloc::payer=signer)]
    pub central_authority: Account<'info, Data>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_increase_data_space(
    ctx: Context<IncreaseDataSpacePayload>,
    _len: u16,
    existing_data: Data,
) -> Result<()> {

    ctx.accounts.central_authority.initialized = existing_data.initialized;
    ctx.accounts.central_authority.multiplier = existing_data.multiplier;
    ctx.accounts.central_authority.centralized_account = existing_data.centralized_account;
    ctx.accounts.central_authority.base_cost = existing_data.base_cost;
    ctx.accounts.central_authority.admin_quota = existing_data.admin_quota;
    ctx.accounts.central_authority.merkle_tree_address = existing_data.merkle_tree_address;
  
  

    Ok(())
}
