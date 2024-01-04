import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { IDL, SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { publicKey } from "@metaplex-foundation/umi";

class SkyTradeRentalToken {
  private program;
  private umi;

  constructor(endpointUrl) {
    let connection = new Connection(endpointUrl);

    this.program = new anchor.Program<SolanaSkyTrade>(
      IDL,
      anchor.web3.SystemProgram.programId,
      {
        connection,
      }
    );

    this.umi = createUmi(endpointUrl).use(mplBubblegum());

    // establishes centralizedAccount
    // establishes rentalMerkleTree

    // umi.use(signerIdentity(authoritySigner));
  }

  public async getAllRentalTokens(owner) {
    // Cache / Store Initial API Call
    const rpcAssetList = await this.umi.rpc.getAssetsByOwner({
      owner: publicKey(owner),
    });
  }

  public async createRentalToken(
    land_token_metadata,
    land_token_merkle_address,
    caller
  ) {}
}
