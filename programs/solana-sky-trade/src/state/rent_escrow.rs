use anchor_lang::prelude::*;

use crate::constant::RENT_ESCROW_PREFIX;

#[account]
pub struct RentEscrow {
    pub caller:Pubkey,
    pub landowner:Pubkey,
    pub rent:u64,
    pub fee:u64,
    pub rent_escrow_bump_seed:[u8;1]
}

impl RentEscrow {
    pub const MAX_SIZE:usize=8+32+32+8+8+1;
    
    pub fn rent_escrow_seeds(&self)-> [&[u8];4] {
         [
            RENT_ESCROW_PREFIX.as_bytes(),
            &self.caller.as_ref(),
            &self.landowner.as_ref(),
            &self.rent_escrow_bump_seed
        ]
    }

}