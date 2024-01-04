import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { loadKeyPair, setupAirDrop } from "../helper";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
  sol,
} from "@metaplex-foundation/umi";
import { join } from "path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  TokenProgramVersion,
  TokenStandard,
  createTree,
  mintV1,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

describe("solana-sky-trade", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaSkyTrade as Program<SolanaSkyTrade>;

  const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("test_seed")],
    program.programId
  )[0];

  const centralizedAccount = loadKeyPair(
    join(__dirname, "..", "wallets", "centralizedAccount.json")
  );

  const rentalMerkleTree = loadKeyPair(
    join(__dirname, "..", "wallets", "rentalMerkleTree.json")
  );

  const collector = loadKeyPair(
    join(__dirname, "..", "wallets", "collector.json")
  );

  const metadataArgs = {
    name: "Rental NFT",
    symbol: "",
    uri: "",
    creators: [],
    sellerFeeBasisPoints: 0,
    primarySaleHappened: false,
    isMutable: false,
    editionNonce: null,
    uses: null,
    collection: null,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  };

  before(async () => {
    // await umi.rpc.airdrop(publicKey(centralizedAccount.publicKey), sol(1));

    let authoritySigner = createSignerFromKeypair(umi, {
      secretKey: centralizedAccount.secretKey,
      publicKey: publicKey(centralizedAccount.publicKey),
    });

    umi.use(signerIdentity(authoritySigner));

    const rentalMerkleTx = await (
      await createTree(umi, {
        merkleTree: createSignerFromKeypair(umi, {
          secretKey: rentalMerkleTree.secretKey,
          publicKey: publicKey(rentalMerkleTree.publicKey),
        }),
        maxDepth: 14,
        maxBufferSize: 64,
      })
    ).sendAndConfirm(umi);
  });

  it("Is initialized!", async () => {
    const bal1 = await provider.connection.getBalance(
      centralizedAccount.publicKey
    );

    console.log(bal1);

    // Add your test here.
    const tx = await program.methods
      .initialize("aaaaaaaaaaa")
      .accounts({
        pda: centralAuthority,
        payer: centralizedAccount.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([centralizedAccount])
      .rpc();
    console.log("Your transaction signature", tx);

    const bal2 = await provider.connection.getBalance(
      centralizedAccount.publicKey
    );

    console.log(bal2);
  });

  it("test_fetch", async () => {
    // IPFS URL was generated from free nft storage

    await mintV1(umi, {
      leafOwner: publicKey(collector.publicKey),
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      metadata: {
        ...metadataArgs,
        uri: "ipfs://bafkreidur5fbetfboueglsoou56h6dpizuv5tjjjd7ascimnhhngm2gct4",
      },
    }).sendAndConfirm(umi);

    const results = await umi.rpc.searchAssets({
      jsonUri:
        "ipfs://bafkreidur5fbetfboueglsoou56h6dpizuv5tjjjd7ascimnhhngm2gct4",
    });

    console.log(results["items"][0].compression);
  });
});
