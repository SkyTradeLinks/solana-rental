use anchor_lang::prelude::*;

#[error_code]
pub enum MyError {
    #[msg("Program already initialized!")]
    AlreadyInitialized,

    #[msg("Invalid authority provided!")]
    InvalidAuthority,

    #[msg("Caller doesn't have enough tokens to complete this call")]
    InsuffientFunds,

    #[msg("Provided Land NFT data is invalid")]
    InvalidLandNFTData,

    #[msg("Provided Accounts should be a multiple of 2")]
    InvalidRemainingAccountsPassed,
}
