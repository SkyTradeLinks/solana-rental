import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { createNonceIx, loadKeyPair, pinFilesToIPFS, sleep } from "../helper";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { join } from "path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  TokenProgramVersion,
  TokenStandard,
  findTreeConfigPda,
  mplBubblegum,
  MPL_BUBBLEGUM_PROGRAM_ID,
  getMetadataArgsSerializer,
  SPL_NOOP_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  getAssetWithProof,
  hash,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import "dotenv/config";
import {
  PublicKey,
  SendTransactionError,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import "dotenv/config";

import { decode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/bs58";

const landAssetId = new PublicKey(
  "HD6m5GvQRaugE6a4ZAzqL5hB3GqMYLeVvw5CAYktkca4"
);

import {
  mplTokenMetadata,
  findMetadataPda,
  findMasterEditionPda,
  MPL_TOKEN_METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import "dotenv/config";
import { associatedAddress } from "@coral-xyz/anchor/dist/cjs/utils/token";
import assert from "assert";
import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";
import { getAssetDataAndProof } from "./utils/getAssetDataAndProof";
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
  let mintAccEnv = process.env.MINT_ACCOUNT_ADDRESS;
  const mintAccount = new anchor.web3.PublicKey(mintAccEnv);
  const fakemintAccount = new anchor.web3.PublicKey(
    "DiW5MWFjPR3AeVd28ChEhsGb96efhHwst9eYwy8YdWEf"
  );
  // DiW5MWFjPR3AeVd28ChEhsGb96efhHwst9eYwy8YdWEf
  const centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));
  // caZUFsSZLD8VK8q652FZm3nZWqq4HFncr4pix8sckYb
  const caller = loadKeyPair(
    join(__dirname, "../wallets/devnet-keys/caller.json")
  );

  const centralizedAccountAta = getAssociatedTokenAddressSync(
    mintAccount,
    centralizedAccount.publicKey
  );

  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const rentalCollection = loadKeyPair(process.env.RENTAL_COLLECTION_MINT);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

  const callerAta = getAssociatedTokenAddressSync(
    mintAccount,
    caller.publicKey
  );

  const treeConfig = findTreeConfigPda(umi, {
    merkleTree: publicKey(rentalMerkleTree.publicKey),
  })[0];

  it("should successfully mint an nft", async () => {
    // LAND token data
    const { landAssetLeafData, landAssetProof, landOwner } =
      await getAssetDataAndProof(landAssetId, umi, provider.connection);

    // RENTAL token data
    let offChainMetadata = {
      name: "RENTAL NFT",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/sky-trade-logo.svg",
      external_url: "https://sky.trade/",
      metadata: {},
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    let metadataBuffer = getMetadataArgsSerializer().serialize({
      name: "Rental NFT",
      symbol: "",
      uri: `ipfs://${cid}/`,
      creators: [
        { address: umi.identity.publicKey, verified: true, share: 100 },
      ],
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: null,
      uses: null,
      collection: {
        key: publicKey(rentalCollection.publicKey.toString()),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });

    let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);
    let feeAccountAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount,
      feeAccount
    );
    let [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    let [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });

    umi.use(signerIdentity(callersigner));

    let dateNow = new Date("2024-08-30T15:30:12.738Z").toISOString(); //'2024-08-26T19:25:12.738Z'
    console.log({ dateNow });
    
    let [rent_escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), landAssetId.toBytes(), Buffer.from(dateNow)],
      program.programId
    );

    const rent_escrow_Ata = associatedAddress({
      mint: mintAccount,
      owner: rent_escrow,
    });

    // let leavesDataLength = new anchor.BN(leavesData.length);
    let leavesDataLength = new anchor.BN(1);


    let ix = await program.methods
      .mintRentalToken(
        landAssetId,
        dateNow,
        bump,
        Buffer.from(metadataBuffer),
        landAssetLeafData
      )
      .accountsStrict({
        centralAuthority: centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        mint: mintAccount, //alt
        caller: caller.publicKey,
        callerAta: callerAta,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        treeConfig: treeConfig,
        landMerkleTree: landMerkleTree.publicKey,
        collectionMint: rentalCollection.publicKey.toString(),
        collectionEdition,
        collectionMetadata,
        bubblegumSigner, //alts
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID, //alt
        logWrapper: SPL_NOOP_PROGRAM_ID, //alt
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, //alt
        systemProgram: anchor.web3.SystemProgram.programId, //alt
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, //alt
        tokenProgram: TOKEN_PROGRAM_ID, //alt
        tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID, //alt
        rentEscrow: rent_escrow,
        rentEscrowAta: rent_escrow_Ata,
        landOwner: landOwner,
        landDelegate: landOwner,
      })
      .remainingAccounts(landAssetProof)
      .instruction();

    /*   let [tx, nonceBlock] = await createTxWithNonce(
      provider.connection,
      nonceAccount.publicKey,
      centralizedAccount.publicKey
    ); */
    let blockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    let AltAddress = new PublicKey(
      "62wUn5TNA7UM1MRUNsovi18oR5CvwpPhAysAWu9PzsfR"
    );

    // get the table from the cluster
    const lookupTableAccount = (
      await provider.connection.getAddressLookupTable(AltAddress)
    ).value;
    const messageV0 = new TransactionMessage({
      payerKey: centralizedAccount.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    transactionV0.sign([caller, centralizedAccount]);
    //console.log({txsize:getTxSize(transactionV0, centralizedAccount.publicKey)});

    const txId = await provider.connection
      .sendTransaction(transactionV0)
      .catch((e) => {
        console.log(e);
        return "";
      });
    console.log(`https://explorer.solana.com/tx/${txId}?cluster=devnet`);
    let mintSx = txId;
    if (mintSx !== "") {
      try {
        let mintTxInfo;

        let i = 0;

        while (i < 6) {
          const tx0 = await umi.rpc.getTransaction(decode(mintSx), {
            commitment: "confirmed",
          });

          if (tx0 !== null) {
            mintTxInfo = tx0;
            break;
          }

          await sleep(1000 * i);

          i++;
        }
      } catch (err) {
        console.log(err);
        throw err;
      }
    } else {
      throw new Error("Transaction failed");
    }
  });

  it("should fail to mint an nft for invalid mins!=(00,30)", async () => {
    // LAND token data
    const { landAssetLeafData, landAssetProof, landOwner } =
      await getAssetDataAndProof(landAssetId, umi, provider.connection);

    // RENTAL token data
    let offChainMetadata = {
      name: "RENTAL NFT",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/sky-trade-logo.svg",
      external_url: "https://sky.trade/",
      metadata: {},
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    let metadataBuffer = getMetadataArgsSerializer().serialize({
      name: "Rental NFT",
      symbol: "",
      uri: `ipfs://${cid}/`,
      creators: [
        { address: umi.identity.publicKey, verified: true, share: 100 },
      ],
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: null,
      uses: null,
      collection: {
        key: publicKey(rentalCollection.publicKey.toString()),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });

    let [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    let [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });

    umi.use(signerIdentity(callersigner));

    let dateNow = new Date("2024-07-25T19:20:12.738Z").toISOString();
    console.log({ dateNow });

    let [rent_escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), landAssetId.toBytes(), Buffer.from(dateNow)],
      program.programId
    );

    const rent_escrow_Ata = associatedAddress({
      mint: mintAccount,
      owner: rent_escrow,
    });

    let leavesDataLength = new anchor.BN(1);

    let ix = await program.methods
      .mintRentalToken(
        landAssetId,
        dateNow,
        bump,
        Buffer.from(metadataBuffer),
        landAssetLeafData
      )
      .accountsStrict({
        centralAuthority: centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        mint: mintAccount, //alt
        caller: caller.publicKey,
        callerAta: callerAta,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        treeConfig: treeConfig,
        landMerkleTree: landMerkleTree.publicKey,
        collectionMint: rentalCollection.publicKey.toString(),
        collectionEdition,
        collectionMetadata,
        bubblegumSigner, //alts
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID, //alt
        logWrapper: SPL_NOOP_PROGRAM_ID, //alt
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, //alt
        systemProgram: anchor.web3.SystemProgram.programId, //alt
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, //alt
        tokenProgram: TOKEN_PROGRAM_ID, //alt
        tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID, //alt
        rentEscrow: rent_escrow,
        rentEscrowAta: rent_escrow_Ata,
        landOwner: landOwner,
        landDelegate: landOwner,
      })
      .remainingAccounts(landAssetProof)
      .instruction();

    /*   let [tx, nonceBlock] = await createTxWithNonce(
      provider.connection,
      nonceAccount.publicKey,
      centralizedAccount.publicKey
    ); */
    let blockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    let AltAddress = new PublicKey(
      "62wUn5TNA7UM1MRUNsovi18oR5CvwpPhAysAWu9PzsfR"
    );

    // get the table from the cluster
    const lookupTableAccount = (
      await provider.connection.getAddressLookupTable(AltAddress)
    ).value;
    const messageV0 = new TransactionMessage({
      payerKey: centralizedAccount.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    transactionV0.sign([caller, centralizedAccount]);
    //console.log({txsize:getTxSize(transactionV0, centralizedAccount.publicKey)});

    await provider.connection
      .sendTransaction(transactionV0)
      .catch((e: SendTransactionError) => {
        console.log("error is", e.message);

        let expectedString =
          "Error Message: Provided minutes in the time should be 00 or 30.";
        let actualString = e.logs[e.logs.length - 2 - 1] as string;
        let ans = actualString.includes(expectedString);
        console.log({ ans });
        assert.equal(ans, true);
      });
  });

  it("should fail as iso string is invalid", async () => {
    // LAND token data
    const { landAssetLeafData, landAssetProof, landOwner } =
      await getAssetDataAndProof(landAssetId, umi, provider.connection);

    // RENTAL token data
    let offChainMetadata = {
      name: "RENTAL NFT",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/sky-trade-logo.svg",
      external_url: "https://sky.trade/",
      metadata: {},
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    let metadataBuffer = getMetadataArgsSerializer().serialize({
      name: "Rental NFT",
      symbol: "",
      uri: `ipfs://${cid}/`,
      creators: [
        { address: umi.identity.publicKey, verified: true, share: 100 },
      ],
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: null,
      uses: null,
      collection: {
        key: publicKey(rentalCollection.publicKey.toString()),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });

    let [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    let [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });

    umi.use(signerIdentity(callersigner));

    let dateNow = "2024-08-26T19:25:12.738Zjljlh";
    console.log({ dateNow });

    let [rent_escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), landAssetId.toBytes(), Buffer.from(dateNow)],
      program.programId
    );

    const rent_escrow_Ata = associatedAddress({
      mint: mintAccount,
      owner: rent_escrow,
    });

    let leavesDataLength = new anchor.BN(1);

    let ix = await program.methods
      .mintRentalToken(
        landAssetId,
        dateNow,
        bump,
        Buffer.from(metadataBuffer),
        landAssetLeafData
      )
      .accountsStrict({
        centralAuthority: centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        mint: mintAccount, //alt
        caller: caller.publicKey,
        callerAta: callerAta,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        treeConfig: treeConfig,
        landMerkleTree: landMerkleTree.publicKey,
        collectionMint: rentalCollection.publicKey.toString(),
        collectionEdition,
        collectionMetadata,
        bubblegumSigner, //alts
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID, //alt
        logWrapper: SPL_NOOP_PROGRAM_ID, //alt
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, //alt
        systemProgram: anchor.web3.SystemProgram.programId, //alt
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, //alt
        tokenProgram: TOKEN_PROGRAM_ID, //alt
        tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID, //alt
        rentEscrow: rent_escrow,
        rentEscrowAta: rent_escrow_Ata,
        landOwner: landOwner,
        landDelegate: landOwner,
      })
      .remainingAccounts(landAssetProof)
      .instruction();

    /*   let [tx, nonceBlock] = await createTxWithNonce(
      provider.connection,
      nonceAccount.publicKey,
      centralizedAccount.publicKey
    ); */
    let blockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    let AltAddress = new PublicKey(
      "62wUn5TNA7UM1MRUNsovi18oR5CvwpPhAysAWu9PzsfR"
    );

    // get the table from the cluster
    const lookupTableAccount = (
      await provider.connection.getAddressLookupTable(AltAddress)
    ).value;
    const messageV0 = new TransactionMessage({
      payerKey: centralizedAccount.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    transactionV0.sign([caller, centralizedAccount]);
    //console.log({txsize:getTxSize(transactionV0, centralizedAccount.publicKey)});

    await provider.connection
      .sendTransaction(transactionV0)
      .catch((e: SendTransactionError) => {
        let expectedString = "Error Message: the iso time string is invalid.";
        //     let actualString=e.logs[(e.logs.length-2-1)] as string
        //     let ans=actualString.includes(expectedString)
        //     console.log({ans})
        //     assert.equal(ans,true);
      });
  });
  it("should fail as time is too far in the future", async () => {
    // LAND token data
    const { landAssetLeafData, landAssetProof, landOwner } =
      await getAssetDataAndProof(landAssetId, umi, provider.connection);

    // RENTAL token data
    let offChainMetadata = {
      name: "RENTAL NFT",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/sky-trade-logo.svg",
      external_url: "https://sky.trade/",
      metadata: {},
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    let metadataBuffer = getMetadataArgsSerializer().serialize({
      name: "Rental NFT",
      symbol: "",
      uri: `ipfs://${cid}/`,
      creators: [
        { address: umi.identity.publicKey, verified: true, share: 100 },
      ],
      sellerFeeBasisPoints: 0,
      primarySaleHappened: false,
      isMutable: false,
      editionNonce: null,
      uses: null,
      collection: {
        key: publicKey(rentalCollection.publicKey.toString()),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });

    let [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    let [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(rentalCollection.publicKey.toString()),
    });

    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });

    umi.use(signerIdentity(callersigner));

    let dateNow = new Date("2025-06-27T19:30:12.738Z").toISOString();
    console.log({ dateNow });

    let [rent_escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), landAssetId.toBytes(), Buffer.from(dateNow)],
      program.programId
    );

    const rent_escrow_Ata = associatedAddress({
      mint: mintAccount,
      owner: rent_escrow,
    });

    let leavesDataLength = new anchor.BN(1);

    let ix = await program.methods
      .mintRentalToken(
        landAssetId,
        dateNow,
        bump,
        Buffer.from(metadataBuffer),
        landAssetLeafData
      )
      .accountsStrict({
        centralAuthority: centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        mint: mintAccount, //alt
        caller: caller.publicKey,
        callerAta: callerAta,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        treeConfig: treeConfig,
        landMerkleTree: landMerkleTree.publicKey,
        collectionMint: rentalCollection.publicKey.toString(),
        collectionEdition,
        collectionMetadata,
        bubblegumSigner, //alts
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID, //alt
        logWrapper: SPL_NOOP_PROGRAM_ID, //alt
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, //alt
        systemProgram: anchor.web3.SystemProgram.programId, //alt
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, //alt
        tokenProgram: TOKEN_PROGRAM_ID, //alt
        tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID, //alt
        rentEscrow: rent_escrow,
        rentEscrowAta: rent_escrow_Ata,
        landOwner: landOwner,
        landDelegate: landOwner,
      })
      .remainingAccounts(landAssetProof)
      .instruction();

    /*   let [tx, nonceBlock] = await createTxWithNonce(
      provider.connection,
      nonceAccount.publicKey,
      centralizedAccount.publicKey
    ); */
    let blockhash = (await provider.connection.getLatestBlockhash()).blockhash;

    let AltAddress = new PublicKey(
      "62wUn5TNA7UM1MRUNsovi18oR5CvwpPhAysAWu9PzsfR"
    );

    // get the table from the cluster
    const lookupTableAccount = (
      await provider.connection.getAddressLookupTable(AltAddress)
    ).value;
    const messageV0 = new TransactionMessage({
      payerKey: centralizedAccount.publicKey,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);

    transactionV0.sign([caller, centralizedAccount]);
    //console.log({txsize:getTxSize(transactionV0, centralizedAccount.publicKey)});

    await provider.connection
      .sendTransaction(transactionV0)
      .catch((e: SendTransactionError) => {
        console.log(e.logs);
        let expectedString =
          "Error Message: Provided time shouldnt be more than 3 month in future.";
        let actualString = e.logs[e.logs.length - 2 - 1] as string;
        let ans = actualString.includes(expectedString);
        console.log({ ans });
        assert.equal(ans, true);
      });
  });
});
