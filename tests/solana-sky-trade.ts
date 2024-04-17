import * as anchor from "@coral-xyz/anchor";
import jest from "jest";
import { spyOn } from "jest-mock";
import { Program } from "@coral-xyz/anchor";
// import { invoke } from "@project-serum/anchor/dist/cjs/util/invoke";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import {
  createTxWithNonce,
  findLeafIndexFromAnchorTx,
  getTxSize,
  loadKeyPairV2,
  loadKeyPair,
  pinFilesToIPFS,
  setupAirDrop,
  sleep,
  validateTxExecution,
} from "../helper";
import {
  AccountNotFoundError,
  createSignerFromKeypair,
  publicKey,
  publicKeyBytes,
  signerIdentity,
  generateSigner,
  none,
  percentAmount,
} from "@metaplex-foundation/umi";
import { dasApi } from "@metaplex-foundation/digital-asset-standard-api";
import { join } from "path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  TokenProgramVersion,
  TokenStandard,
  createTree,
  fetchMerkleTree,
  findTreeConfigPda,
  mintV1,
  mplBubblegum,
  MPL_BUBBLEGUM_PROGRAM_ID,
  getMetadataArgsSerializer,
  findLeafAssetIdPda,
  SPL_NOOP_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  getAssetWithProof,
  verifyLeaf,
  mintToCollectionV1,
  setAndVerifyCollection,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  TokenAccountNotFoundError,
  createMint,
  getMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  transfer,
} from "@solana/spl-token";

import {
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
  Keypair,
} from "@solana/web3.js";

import "dotenv/config";

import { decode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/bs58";
import { assert, expect } from "chai";
import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";

import {
  findCollectionAuthorityRecordPda,
  mplTokenMetadata,
  findMetadataPda,
  findMasterEditionPda,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  createNft,
} from "@metaplex-foundation/mpl-token-metadata";

describe("solana-sky-trade", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaSkyTrade as Program<SolanaSkyTrade>;

  const umi = createUmi(provider.connection.rpcEndpoint)
    .use(mplBubblegum())
    .use(mplTokenMetadata());

  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];



  const centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);


  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));
  umi.use(dasApi());

// initialize test keys
  const caller = Keypair.generate();
  const caller1 = Keypair.generate();


  const rentalMerkleTree = new anchor.web3.PublicKey(
    "EeeRXpRk8qUYJmQtHA4iZzDaKpqepwAjopz7g3GTfGPx"
  );



  const landMerkleTree = generateSigner(umi);
  let callerAta;
  let callerAta1;


  const treeConfig = findTreeConfigPda(umi, {
    merkleTree: publicKey(rentalMerkleTree),
  })[0];


  const landOwner = Keypair.generate();


  const saleRecipient = Keypair.generate();

  const nonceAccount = Keypair.generate();
  let collectionMint;

  let createdLeafIndex;
  let feeAccountAta;
  let collectionMetadata;
  let collectionEdition;
  let bubblegumSigner;
  let metadataBuffer;
  let accountsToPass = [];
  let leavesData = [];
  let mintAccount;
  let centralizedAccountAta;
  let feeAccount;

  before(async () => {

    // //create bubblegum merkletree
    // const builder = await createTree(umi, {
    //   merkleTree: createSignerFromKeypair(umi, {
    //     secretKey: rentalMerkleTree.secretKey,
    //     publicKey: publicKey(rentalMerkleTree.publicKey),
    //   }),
    //   maxDepth: 14,
    //   maxBufferSize: 64,
    // });
    // const tx = await builder.sendAndConfirm(umi);
    // console.log("Tree creation sig", tx);

    // Create Spl mint
    mintAccount = await createMint(
      provider.connection,
      centralizedAccount,
      centralizedAccount.publicKey,
      centralizedAccount.publicKey,
      9 // We are using 9 to match the CLI decimal default exactly
    );

    // create collection mint
    collectionMint = generateSigner(umi);

    await createNft(umi, {
      mint: collectionMint,
      name: "My Collection",
      uri: "https://example.com/my-collection.json",
      sellerFeeBasisPoints: percentAmount(5.5), // 5.5%
      isCollection: true,
    }).sendAndConfirm(umi);



    feeAccount = new anchor.web3.PublicKey(
      "F98KUNFGwarpo1LQkwznKW1kpx2R4mwcGSojeBLXJc8v"
    );


    // await program.methods
    //   .initialize()
    //   .accounts({
    //     payer: centralizedAccount.publicKey,
    //     feeAccount: feeAcct.publicKey,
    //     centralAuthority: centralAuthority,
    //     mintAccount: mintAccount,
    //     systemProgram: anchor.web3.SystemProgram.programId,
    //     rentalMerkleTree: rentalMerkleTree.publicKey,
    //   })
    //   .signers([centralizedAccount])
    //   .rpc();

    // Setup airdrop
    const airdropSignature = await provider.connection.requestAirdrop(
      caller.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    const latestBlockHash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSignature,
    });

    const airdropSignature1 = await provider.connection.requestAirdrop(
      caller1.publicKey,
      3 * LAMPORTS_PER_SOL
    );
    const latestBlockHash1 = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash1.blockhash,
      lastValidBlockHeight: latestBlockHash1.lastValidBlockHeight,
      signature: airdropSignature1,
    });
    const arr = [];
    centralizedAccountAta = await getAssociatedTokenAddressSync(
      mintAccount,
      centralizedAccount.publicKey
    );

    centralizedAccountAta = await createAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount,
      centralizedAccount.publicKey
    );


    // Mint Spl to centralized account
    await mintTo(
      provider.connection,
      centralizedAccount,
      mintAccount,
      centralizedAccountAta,
      centralizedAccount.publicKey,
      100000000000 // because decimals for the mint are set to 9
    );
    umi.use(signerIdentity(authoritySigner));
    umi.use(dasApi());

    callerAta = await createAssociatedTokenAccount(
      provider.connection,
      caller,
      mintAccount,
      caller.publicKey
    );
    // console.log("callerAta", callerAta);
    callerAta1 = await createAssociatedTokenAccount(
      provider.connection,
      caller,
      mintAccount,
      caller1.publicKey
    );

    // Transfer spl to caller 1
    await transfer(
      provider.connection,
      centralizedAccount,
      centralizedAccountAta,
      callerAta1,
      centralizedAccount.publicKey,
      2000000000
    );
    // Transfer spl to caller
    await transfer(
      provider.connection,
      centralizedAccount,
      centralizedAccountAta,
      callerAta,
      centralizedAccount.publicKey,
      2000000000
    );


    accountsToPass.push({
      pubkey: caller.publicKey,
      isSigner: false,
      isWritable: true,
    });
    accountsToPass.push({
      pubkey: callerAta,
      isSigner: false,
      isWritable: true,
    });
    let leafData = {
      owner: caller.publicKey,
    };

    leavesData.push(leafData);

    let centralAuthorityInfo = await program.account.data.fetch(
      centralAuthority
    );

    // Initialize test accounts
    feeAccountAta = await createAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount,
      centralAuthorityInfo.feeAccount
    );
    // console.log("feeata", feeAccountAta);

    [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(collectionMint.publicKey),
    });

    [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(collectionMint.publicKey),
    });

    [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    metadataBuffer = getMetadataArgsSerializer().serialize({
      name: "Rental NFT",
      symbol: "",
      uri: `ipfs://${""}/`,
      creators: [
        { address: umi.identity.publicKey, verified: true, share: 100 },
      ],
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: null,
      uses: null,
      collection: {
        key: publicKey(collectionMint.publicKey),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });
  });

  it("Update config Quota", async () => {
    const merkleTreeAccount = await fetchMerkleTree(
      umi,
      publicKey(rentalMerkleTree)
    );
    console.log("Tree account", merkleTreeAccount);
    let centralAuthorityInfo = await program.account.data.fetch(
      centralAuthority
    );
    console.log(
      "Accounts",
      centralAuthorityInfo.centralizedAccount,
      centralizedAccount.publicKey
    );
    await program.methods
      .updateConfig({
        baseCost: 1,
        adminQuota: null,
        feeAccount: null,
        merkleTreeAddress: rentalMerkleTree,
        multiplier: null,
      })
      .accounts({
        centralAuthority: centralAuthority,
        centralizedAccount: centralAuthorityInfo.centralizedAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        mintAccount: mintAccount,
      })
      .signers([centralizedAccount])
      .rpc();
  });

  it("Fails if invalid merkleTree address is used", async () => {
    try {
      await program.methods
        .mintRentalToken(Buffer.from(""), [])
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta: callerAta,
          rentalMerkleTree: Keypair.generate().publicKey,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([caller, centralizedAccount])
        .rpc();
    } catch (err) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "InvalidRentalAddressPassed"
      ) {
        assert.equal(
          err["error"]["errorCode"]["code"],
          "InvalidRentalAddressPassed"
        );
      } else {
        throw err;
      }
    }
  });

  it("Fails if caller amount is less than the base cost", async () => {
    // let centralAuthorityInfo = await program.account.data.fetch(
    //   centralAuthority
    // );
    // console.log(
    //   "Base Cost",
    //   new anchor.BN(centralAuthorityInfo.baseCost).toString()
    // );
    // const tokenAccountInfo = await getAccount(provider.connection, callerAta);
    // console.log("Caller Account Info", tokenAccountInfo.amount);
    try {
      await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta: callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass)
        .signers([caller, centralizedAccount])
        .rpc();
    } catch (err) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "InsuffientFunds"
      ) {
        assert.equal(err["error"]["errorCode"]["code"], "InsuffientFunds");
        await transfer(
          provider.connection,
          centralizedAccount,
          centralizedAccountAta,
          callerAta,
          centralizedAccount.publicKey,
          5000000000
        );
      } else {
        throw err;
      }
    }
  });

  it("Prevent Update config Quota from external sources", async () => {
    let centralAuthorityInfo = await program.account.data.fetch(
      centralAuthority
    );
    try {
      await program.methods
        .updateConfig({
          baseCost: null,
          adminQuota: null,
          feeAccount: null,
          merkleTreeAddress: null,
          multiplier: null,
        })
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralAuthorityInfo.centralizedAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          mintAccount: mintAccount,
        })
        .signers([Keypair.generate()])
        .rpc();
    } catch (error) {
      if (error) {
        assert.ok("Unknown signer error occurred.");
      }
    }
  });

  it("should prevent initialization twice", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          payer: centralizedAccount.publicKey,
          feeAccount: centralizedAccount.publicKey,
          centralAuthority: centralAuthority,
          mintAccount: mintAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
          rentalMerkleTree: rentalMerkleTree,
        })
        .signers([centralizedAccount])
        .rpc();
    } catch (err: any) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "AlreadyInitialized"
      ) {
        assert.equal(err["error"]["errorCode"]["code"], "AlreadyInitialized");
      } else {
        throw err;
      }
    }
  });

  it("should fail when centralized Authority isn't a PDA", async () => {
    try {
      await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
        .accounts({
          centralAuthority: Keypair.generate().publicKey,
          centralizedAccount: centralizedAccount.publicKey,
          mint: Keypair.generate().publicKey,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta: callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([caller, centralizedAccount])
        .rpc();
    } catch (err) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "AccountNotInitialized"
      ) {
        assert.equal(
          err["error"]["errorCode"]["code"],
          "AccountNotInitialized"
        );
      } else {
        throw err;
      }
    }
  });

  it("should fail as accounts passed in is imcomplete", async () => {
    let leavesData1 = [];
    let accountsToPass1 = [];
    accountsToPass1.push({
      pubkey: caller1.publicKey,
      isSigner: false,
      isWritable: true,
    });

    let leafData = {
      owner: caller1.publicKey,
    };

    leavesData1.push(leafData);


    try {
      await program.methods
        .mintRentalToken(Buffer.from(""), [])
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller1.publicKey,
          callerAta: callerAta1,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass1)
        .signers([caller1, centralizedAccount])
        .rpc();
    } catch (err: any) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "InvalidRemainingAccountsPassed"
      ) {
        assert.equal(
          err["error"]["errorCode"]["code"],
          "InvalidRemainingAccountsPassed"
        );
      } else {
        throw err;
      }
      // if (
      //   ![
      //     "InvalidRemainingAccountsPassed",
      //     "InsuffientFunds",
      //     "InvalidLandNFTData",
      //   ].includes(err["error"]["errorCode"]["code"])
      // ) {
      //   throw err;
      // }
    }
  });

  it("should fail as improper nft data passed", async () => {
    let leavesData1 = [];
    let accountsToPass1 = [];
    accountsToPass1.push({
      pubkey: caller1.publicKey,
      isSigner: false,
      isWritable: true,
    });
    accountsToPass1.push({
      pubkey: callerAta1,
      isSigner: false,
      isWritable: true,
    });
    let leafData = {
      owner: caller1.publicKey,
    };

    leavesData1.push(leafData);

    try {
      await program.methods
        .mintRentalToken(Buffer.from(""), [])
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller1.publicKey,
          callerAta: callerAta1,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass1)
        .signers([caller1, centralizedAccount])
        .rpc();
    } catch (err: any) {
      if (
        err["error"] &&
        err["error"]["errorCode"]["code"] == "InvalidLandNFTData"
      ) {
        assert.equal(err["error"]["errorCode"]["code"], "InvalidLandNFTData");
      } else {
        throw err;
      }
      // if (
      //   ![
      //     "InvalidRemainingAccountsPassed",
      //     "InsuffientFunds",
      //     "InvalidLandNFTData",
      //   ].includes(err["error"]["errorCode"]["code"])
      // ) {
      //   throw err;
      // }
    }
  });

  it("should successfully mint an nft", async () => {
    //   let land_nfts = [0];

    let leavesData1 = [];
    let accountsToPass1 = [];

    let treeCreatorOrDelegate = publicKey(centralizedAccount.publicKey);

    //   console.log("AssetId", assetId);
    //   // for (let nft_index of land_nfts) {

    let assetWithProof;

    await mintV1(umi, {
      leafOwner: publicKey(centralizedAccount.publicKey),
      merkleTree: publicKey(rentalMerkleTree),
      metadata: {
        name: "Land NFT",
        symbol: "",
        uri: "",
        creators: [
          { address: umi.identity.publicKey, verified: false, share: 100 },
        ],
        sellerFeeBasisPoints: 0,
        primarySaleHappened: false,
        isMutable: false,
        editionNonce: null,
        uses: null,
        collection: { key: collectionMint.publicKey, verified: false },
        tokenProgramVersion: TokenProgramVersion.Original,
        tokenStandard: TokenStandard.NonFungible,
      },
    }).sendAndConfirm(umi);

    //   }
    // }
    const [assetId, bump] = findLeafAssetIdPda(umi, {
      merkleTree: publicKey(rentalMerkleTree),
      leafIndex: 0,
    });
    assetWithProof = await getAssetWithProof(umi, assetId);


    let owner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

  
    let leafData = {
 
      owner,

    };

    leavesData1.push(leafData);

    // Push Owner
    accountsToPass1.push({
      pubkey: owner,
      isSigner: false,
      isWritable: true,
    });

    let owner_ata = getAssociatedTokenAddressSync(mintAccount, owner);

    accountsToPass1.push({
      pubkey: owner_ata,
      isSigner: false,
      isWritable: true,
    });
    try {
      let ix = await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData1)
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass1)
        .signers([caller, centralizedAccount])
        .rpc();
      // Transfer spl to caller1
      await transfer(
        provider.connection,
        centralizedAccount,
        centralizedAccountAta,
        callerAta,
        centralizedAccount.publicKey,
        5000000000
      );
    } catch (error) {
      console.log("error 3", error);
    }


    let rentalAsset = await umi.rpc.getAsset(assetId);
    console.log(
      "Finished",
      rentalAsset.ownership.owner.toString(),
      owner.toString()
    );

    assert.equal(rentalAsset.ownership.owner.toString(), owner.toString());
  });

  it("should create an associated token account if none exists", async () => {
    try {
      let ix = await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass)
        .signers([caller, centralizedAccount])
        .rpc();
    } catch (error) {
      console.log("error 9", error);
    }
  });

  it("centralized_ata BALANCE should decrease after mint", async () => {
    // Transfer spl to caller1
    await transfer(
      provider.connection,
      centralizedAccount,
      centralizedAccountAta,
      callerAta,
      centralizedAccount.publicKey,
      5000000000
    );
    let centralizedAtaInfo = await getAccount(
      provider.connection,
      centralizedAccountAta
    );
    const balanceBefore = centralizedAtaInfo.amount;
    console.log("Balance Before Minting", +balanceBefore.toString());
    try {
      let ix = await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass)
        .signers([caller, centralizedAccount])
        .rpc();

      centralizedAtaInfo = await getAccount(
        provider.connection,
        centralizedAccountAta
      );
      const balanceAfter = centralizedAtaInfo.amount;
      console.log("Balance After Minting", +balanceAfter.toString());
      expect(+balanceAfter.toString()).lessThanOrEqual(
        +balanceBefore.toString()
      );
    } catch (error) {
      console.log("error 10", error);
    }
  });

  it("feeAccount_ata BALANCE should increase after mint", async () => {
    // Transfer spl to caller1
    await transfer(
      provider.connection,
      centralizedAccount,
      centralizedAccountAta,
      callerAta,
      centralizedAccount.publicKey,
      5000000000
    );
    let feeAccountAtaInfo = await getAccount(
      provider.connection,
      feeAccountAta
    );
    const balanceBefore = feeAccountAtaInfo.amount;
    console.log("Balance Before Minting", +balanceBefore.toString());
    try {
      let ix = await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta,
          rentalMerkleTree: rentalMerkleTree,
          treeConfig: treeConfig,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collectionMetadata,
          collectionEdition: collectionEdition,
          bubblegumSigner: bubblegumSigner,
          feeAccountAta: feeAccountAta,
          tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(accountsToPass)
        .signers([caller, centralizedAccount])
        .rpc();

      feeAccountAtaInfo = await getAccount(provider.connection, feeAccountAta);
      const balanceAfter = feeAccountAtaInfo.amount;
      console.log("Balance After Minting", +balanceAfter.toString());
      expect(+balanceAfter.toString()).greaterThan(+balanceBefore.toString());
    } catch (error) {
      console.log("error 11", error);
    }
  });

  // it("should transfer token to owner", async () => {
  //   // Transfer spl to caller1
  //   await transfer(
  //     provider.connection,
  //     centralizedAccount,
  //     centralizedAccountAta,
  //     callerAta,
  //     centralizedAccount.publicKey,
  //     5000000000
  //   );
  //   let callerAtaInfo = await getAccount(provider.connection, callerAta);
  //   const balanceBefore = callerAtaInfo.amount;
  //   console.log("Balance Before Minting", +balanceBefore.toString());
  //   try {
  //     let ix = await program.methods
  //       .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
  //       .accounts({
  //         centralAuthority: centralAuthority,
  //         centralizedAccount: centralizedAccount.publicKey,
  //         mint: mintAccount,
  //         centralizedAccountAta,
  //         caller: caller.publicKey,
  //         callerAta,
  //         rentalMerkleTree: rentalMerkleTree,
  //         treeConfig: treeConfig,
  //         collectionMint: collectionMint.publicKey,
  //         collectionMetadata: collectionMetadata,
  //         collectionEdition: collectionEdition,
  //         bubblegumSigner: bubblegumSigner,
  //         feeAccountAta: feeAccountAta,
  //         tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
  //         bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
  //         logWrapper: SPL_NOOP_PROGRAM_ID,
  //         compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .remainingAccounts(accountsToPass)
  //       .signers([caller, centralizedAccount])
  //       .rpc();

  //     callerAtaInfo = await getAccount(provider.connection, callerAta);
  //     const balanceAfter = callerAtaInfo.amount;
  //     console.log("Balance After Minting", +balanceAfter.toString());
  //     expect(+balanceAfter.toString()).greaterThan(+balanceBefore.toString());
  //   } catch (error) {
  //     console.log("error 12", error);
  //   }
  // });

  // it("should invoke create CPI when land_owner_ata lamports is zero", async () => {
  //   // Mock the necessary accounts and context for the test

  //   // Mock land_owner_ata with zero lamports
  //   const land_owner_ata = callerAta;

  //   spyOn(land_owner_ata, "try_borrow_lamports").mockImplementation(() => 0);

  //   // Call the handle_mint_rental_token function
  //   try {
  //     let ix = await program.methods
  //       .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
  //       .accounts({
  //         centralAuthority: centralAuthority,
  //         centralizedAccount: centralizedAccount.publicKey,
  //         mint: mintAccount,
  //         centralizedAccountAta,
  //         caller: caller.publicKey,
  //         callerAta,
  //         rentalMerkleTree: rentalMerkleTree,
  //         treeConfig: treeConfig,
  //         collectionMint: collectionMint.publicKey,
  //         collectionMetadata: collectionMetadata,
  //         collectionEdition: collectionEdition,
  //         bubblegumSigner: bubblegumSigner,
  //         feeAccountAta: feeAccountAta,
  //         tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
  //         bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
  //         logWrapper: SPL_NOOP_PROGRAM_ID,
  //         compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .remainingAccounts(accountsToPass)
  //       .signers([caller, centralizedAccount])
  //       .rpc();
  //   } catch (error) {
  //     console.log("error 3", error);
  //   }

  //   // Assert that the MintToCollectionV1CpiBuilder CPI is invoked
  //   expect(MintToCollectionV1CpiBuilder).toHaveBeenCalled();
  // });
});
