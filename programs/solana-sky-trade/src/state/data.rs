use anchor_lang::prelude::*;
use mpl_bubblegum::{hash::hash_creators, types::Creator};

use crate::CustomErrors;

#[account]
pub struct Data {
    pub initialized: bool,
    pub centralized_account: Pubkey,
    pub base_cost: u64,
    pub admin_quota: f64,
    pub auction_house_address: Pubkey,
    pub fee_account: Pubkey,
    pub mint_address: Pubkey,
    pub land_creators: Creators,
}

impl Data {
    pub const MAX_SIZE: usize = 8 + 1 + 32 + 8 + 8 + 32 + 32 + 32 + 32 + 32 + 32;

    pub fn check_royalties_receiver(&self, received_key: Pubkey) -> Result<()> {
        require_keys_eq!(
            self.land_creators.royalties_receiver,
            received_key,
            CustomErrors::InvalidReceivedCreator
        );
        Ok(())
    }
    pub fn check_mint_creator(&self, received_key: Pubkey) -> Result<()> {
        require_keys_eq!(
            self.land_creators.mint_creator,
            received_key,
            CustomErrors::InvalidReceivedCreator
        );
        Ok(())
    }
    pub fn check_verification_creator(&self, received_key: Pubkey) -> Result<()> {
        require_keys_eq!(
            self.land_creators.verification_creator,
            received_key,
            CustomErrors::InvalidReceivedCreator
        );
        Ok(())
    }

    /// Checks that the `received_creator_hash` matches the one generated based on the keys saved in this `Data` account.
    pub fn check_received_creator_hash(&self, received_creator_hash: &[u8; 32]) -> Result<()> {
        let creators = vec![
            Creator {
                address: self.land_creators.royalties_receiver,
                verified: false,
                share: 100,
            },
            Creator {
                address: self.land_creators.mint_creator,
                verified: true,
                share: 0,
            },
            Creator {
                address: self.land_creators.verification_creator,
                verified: true,
                share: 0,
            },
        ];
        let generated_hash = hash_creators(&creators);

        if &generated_hash != received_creator_hash {
            return err!(CustomErrors::InvalidReceivedCreatorHash);
        }

        Ok(())
    }
}

#[derive(Clone, AnchorDeserialize, AnchorSerialize)]
pub struct Creators {
    pub royalties_receiver: Pubkey,
    pub mint_creator: Pubkey,
    pub verification_creator: Pubkey,
}
