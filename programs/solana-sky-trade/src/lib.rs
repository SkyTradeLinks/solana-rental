use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("28G2s5E7pgfX1xBnLfQPagQsVcgBgqhjESpp9UqcPUdq");

#[program]
pub mod solana_sky_trade {
    use super::*;

    pub fn initialize(ctx: Context<InitializePayload>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn mint_rental_token<'info>(
        ctx: Context<'_, '_, '_, 'info, MintRentalTokenPayload<'info>>,
        mint_metadata_args: Vec<u8>,
        leaves_data: Vec<LeafData>,
    ) -> Result<()> {
        handle_mint_rental_token(ctx, mint_metadata_args, leaves_data)
    }

    pub fn transfer_rental_token<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferRentalTokenPayload<'info>>,
        leaf_data: LeafData,
    ) -> Result<()> {
        handle_transfer_rental_token(ctx, leaf_data)
    }

    pub fn update_config(
        ctx: Context<UpdateConfigPayload>,
        payload: UpdateConfigData,
    ) -> Result<()> {
        handle_update_config(ctx, payload)
    }

    pub fn increase_data_space(
        ctx: Context<IncreaseDataSpacePayload>,
        len: u16,
        existing_data: Data,
    ) -> Result<()> {
        handle_increase_data_space(ctx, len, existing_data)
    }
}
