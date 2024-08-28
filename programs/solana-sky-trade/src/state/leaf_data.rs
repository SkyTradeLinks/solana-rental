use anchor_lang::prelude::*;

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct LeafData {
    pub index: u32,
    pub nonce: u64,
    pub root: [u8; 32],
    pub hash: [u8; 32],
    pub creator_hash: [u8; 32],
    // pub metadata: AnchorMetadataArgs,
}

// #[derive(AnchorSerialize, AnchorDeserialize, Clone)]
// pub struct AnchorMetadataArgs {
//     pub name: String,
//     pub symbol: String,
//     pub uri: String,
//     pub seller_fee_basis_points: u16,
//     pub primary_sale_happened: bool,
//     pub is_mutable: bool,
// }
