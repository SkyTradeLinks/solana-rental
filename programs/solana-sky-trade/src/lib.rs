use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("DuxeEbaDrJRSkE1rrAG5RUcM5JxZuoSqTavEbhaqq65J");

#[program]
pub mod solana_sky_trade {

    use super::*;

    pub fn initialize(ctx: Context<InitializePayload>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn mint_rental_token<'info>(
        ctx: Context<'_, '_, '_, 'info, MintRentalTokenPayload<'info>>,
        land_asset_id: Pubkey,
        creation_time: String,
        bump: u8,
        mint_metadata_args: Vec<u8>,
        leaves_data: u64,
        land_asset_id_leaf_data: LeafData,
    ) -> Result<()> {
        handle_mint_rental_token(
            ctx,
            land_asset_id,
            creation_time,
            bump,
            mint_metadata_args,
            leaves_data,
            land_asset_id_leaf_data,
        )
    }

    pub fn transfer_on_expiry<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferOnExpiryAccounts<'info>>,
        leaf: LeafData,
    ) -> Result<()> {
        msg!("starting transfer");
        handle_transfer_on_expiry(ctx, leaf)
    }

    pub fn update_config<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateConfigPayload<'info>>,
        data: UpdateConfigData,
    ) -> Result<()> {
        msg!("updating config");
        handle_update_config(ctx, data)
    }
}
