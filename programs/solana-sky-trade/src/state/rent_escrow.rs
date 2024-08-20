use anchor_lang::prelude::*;

use crate::constant::RENT_ESCROW_PREFIX;

#[account]
pub struct RentEscrow {
    
}

impl RentEscrow {
    pub const MAX_SIZE:usize=8;
    
   /*  pub fn rent_escrow_seeds(&self)-> [&[u8];2] {
         [
            RENT_ESCROW_PREFIX.as_bytes(),
            &self.caller.as_ref(),
        ]
    } */

}