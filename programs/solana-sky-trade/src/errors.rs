use anchor_lang::prelude::*;

#[error_code]
pub enum CustomErrors {
    #[msg("Program already initialized!")]
    AlreadyInitialized,

    #[msg("Invalid authority provided!")]
    InvalidAuthority,

    #[msg("Payment receiver is not the actual owner")]
    InvalidReceiver,

    #[msg("Caller doesn't have enough funds to complete this call")]
    InsuffientFunds,

    #[msg("Provided Land NFT data is invalid")]
    InvalidLandNFTData,

    #[msg("Provided Rental Address is invalid")]
    InvalidRentalAddressPassed,

    #[msg("Provided Rental escrow Address is invalid")]
    InvalidRentalEscrowAddressPassed,

    #[msg("Provided Accounts should be a multiple of 2")]
    InvalidRemainingAccountsPassed,

    #[msg("Provided minutes in the time should be 00 or 30")]
    InvalidTime,

    #[msg("Rental token has not expired yet")]
    InvalidTransferTime,
}
