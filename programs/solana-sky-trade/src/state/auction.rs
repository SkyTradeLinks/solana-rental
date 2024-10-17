use anchor_lang::prelude::*;

#[account]
/// Created by the Token owner, holds the most updated data of the Auction
pub struct Auction {
    pub bump: [u8; 1],
    pub nonce_bytes: [u8; 8],
    pub asset_id: Pubkey,
    pub merkle_tree: Pubkey,
    pub initial_price: u64,
    /// Timestamp until which the `Auction` accepts bids
    pub end_time: i64,
    /// Owner of the cNFT and creator of the `Auction`
    pub seller: Pubkey,
    /// The signing account that originally paid rent for the Auction and ATAs creation.
    /// And to which the rent is returned upon Auction finalization
    pub rent_payer: Pubkey,
    /// The mint in which this individual `Auction` is based
    pub payment_currency: Pubkey,
    pub bidder: Option<Pubkey>,
    pub current_price: u64,
    pub filled_amount: u64,
    pub top_up_bid_deadline: i64,
    pub asset_verification_deadline: i64,
    pub is_verified: bool,
}
