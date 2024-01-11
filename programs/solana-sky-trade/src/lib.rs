use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
use mpl_bubblegum::types::{MetadataArgs, TokenProgramVersion, TokenStandard};
pub use state::*;

declare_id!("J1CDakgKrBBzM91z3Q2qpJjanFnqJAtTuPND2fbVzfx4");

#[program]
pub mod solana_sky_trade {
    use super::*;

    pub fn initialize(ctx: Context<InitializePayload>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn mint_rental_token<'info>(
        ctx: Context<'_, '_, '_, 'info, MintRentalTokenPayload<'info>>,
        metadata_args: Vec<u8>,
        leaves_data: Vec<LeafData>,
    ) -> Result<()> {
        handle_mint_rental_token(ctx, metadata_args, leaves_data)
    }

    pub fn transfer_rental_token<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferRentalTokenPayload<'info>>,
        leaf_data: LeafData,
    ) -> Result<()> {
        handle_transfer_rental_token(ctx, leaf_data)
    }

    pub fn update_config(
        ctx: Context<UpdateConfigPayload>,
        base_cost: Option<u64>,
        admin_quota: Option<f64>,
    ) -> Result<()> {
        handle_update_config(ctx, base_cost, admin_quota)
    }
}

#[derive(Debug, Clone, AnchorDeserialize, AnchorSerialize)]
pub struct LeafData {
    pub leaf_index: u32,
    pub leaf_nonce: u64,
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub root: Pubkey,
    pub leaf_hash: Option<[u8; 32]>,
}

pub fn get_rental_token_metadata() -> MetadataArgs {
    MetadataArgs {
        name: String::from("Test NFT"),
        symbol: String::from("T-NFT"),
        uri: String::from("Test URL"),
        creators: vec![],
        seller_fee_basis_points: 0,
        primary_sale_happened: false,
        is_mutable: false,
        edition_nonce: None,
        uses: None,
        collection: None,
        token_program_version: TokenProgramVersion::Original,
        token_standard: Some(TokenStandard::NonFungible),
    }
}
