use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

pub use errors::*;
pub use instructions::*;
pub use state::*;

#[cfg(feature = "mainnet")]
declare_id!("CAYRkXh52saZDzpQHwx9gMgzs7AnCmS5RnLFXhp2yzJF");

#[cfg(not(feature = "mainnet"))]
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

    pub fn update_config(
        ctx: Context<UpdateConfigPayload>,
        payload: UpdateConfigData,
    ) -> Result<()> {
        handle_update_config(ctx, payload)
    }
}
