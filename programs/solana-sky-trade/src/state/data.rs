use anchor_lang::prelude::*;

#[account]
pub struct Data {
    pub initialized: bool,
    pub centralized_account: Pubkey,
    pub base_cost: u64,
    pub admin_quota: f64,
    pub merkle_tree_address: Pubkey,
    pub fee_account: Pubkey
}

impl Data {
    pub const MAX_SIZE: usize =8+1+32+8+8+32+32;
}
