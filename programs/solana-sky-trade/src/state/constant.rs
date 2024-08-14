use anchor_lang::prelude::Pubkey;

pub const RENT_ESCROW_PREFIX: &str = "rent";


#[derive(Clone)]
pub struct MplBubblegumProgramAccount;
impl anchor_lang::Id for MplBubblegumProgramAccount {
    fn id() -> Pubkey {
        mpl_bubblegum::programs::MPL_BUBBLEGUM_ID
    }
}

#[derive(Clone)]
pub struct SplAccountCompressionProgramAccount;
impl anchor_lang::Id for SplAccountCompressionProgramAccount {
    fn id() -> Pubkey {
        mpl_bubblegum::programs::SPL_ACCOUNT_COMPRESSION_ID
    }
}

#[derive(Clone)]
pub struct NoopProgramAccount;
impl anchor_lang::Id for NoopProgramAccount {
    fn id() -> Pubkey {
        mpl_bubblegum::programs::SPL_NOOP_ID
    }
}
