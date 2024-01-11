use anchor_lang::prelude::*;

#[account]

pub struct Data {
    pub initialized: bool,           // 1
    pub centralized_account: Pubkey, // 32
    pub base_cost: u64,              // 8
    pub admin_quota: f64,            // 8
}

impl Data {
    pub const MAX_SIZE: usize = (1 + 32 + 8 + 8);
}
