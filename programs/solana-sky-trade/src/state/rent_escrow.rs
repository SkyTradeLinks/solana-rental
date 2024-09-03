use anchor_lang::prelude::*;

#[account]
pub struct RentEscrow {
    pub land_asset_id: Pubkey,
    pub creation_time: String,
    pub end_time:String,
    pub expected_cost: u64,
    pub fee_quota: u64,
    pub escrow_bump: [u8; 1],
}

impl RentEscrow {
    pub const MAX_SIZE: usize = 32 + 24+24+8+8 + 1;

    pub fn escrow_seeds(&self) -> [&[u8]; 4] {
        [
            b"escrow",
            &self.land_asset_id.as_ref(),
            &self.creation_time.as_ref(),
            &self.escrow_bump,
        ]
    }
}
