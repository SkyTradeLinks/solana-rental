import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import {
  createTxWithNonce,
  findLeafIndexFromAnchorTx,
  getTxSize,
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
} from "@metaplex-foundation/umi";
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
  transfer,
  getAssetWithProof,
  verifyLeaf,
  mintToCollectionV1,
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
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
} from "@solana/spl-token";

import {
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import "dotenv/config";

import { decode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/bs58";
import { assert } from "chai";
import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";

import {
  findCollectionAuthorityRecordPda,
  mplTokenMetadata,
  findMetadataPda,
  findMasterEditionPda,
  MPL_TOKEN_METADATA_PROGRAM_ID,
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

  const mintAccount = new anchor.web3.PublicKey(
    "DSwBdJ6o84BfHbzmfBYk31PEHpr7tCBGfjVhMKPcBShi"
  );

  // DiW5MWFjPR3AeVd28ChEhsGb96efhHwst9eYwy8YdWEf
  const centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  console.log(centralizedAccount.publicKey);

  // AaNPFmjn23stSpFknsuHzB3UvWwnxVU9dXygqjHhnkiu
  const caller = loadKeyPair(join(__dirname, "wallets", "caller.json"));

  const centralizedAccountAta = getAssociatedTokenAddressSync(
    mintAccount,
    centralizedAccount.publicKey
  );

  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

  const callerAta = getAssociatedTokenAddressSync(
    mintAccount,
    caller.publicKey
  );

  const treeConfig = findTreeConfigPda(umi, {
    merkleTree: publicKey(rentalMerkleTree.publicKey),
  })[0];

  const landOwner = new anchor.web3.PublicKey(
    "73ajJBDet2TbccHesc1CgHcMbDG83fafiy5iP3iGCEYL"
  );

  const saleRecipient = new anchor.web3.PublicKey(
    "AUda7XmQ9M4msWsZNzeWHiVND5CtbfLo2fLsiwQtQjrH"
  );

  const nonceAccount = loadKeyPair(
    join(__dirname, "wallets", "nonceAccount.json")
  );

  let createdLeafIndex;

  before(async () => {
    const arr = [];

    for (const el of [centralizedAccount, caller]) {
      let bal = await provider.connection.getBalance(el.publicKey);

      bal = bal / LAMPORTS_PER_SOL;

      if (bal < 5) arr.push(el);
    }

    try {
      // setupAirDrop(provider, arr);
    } catch (err) {}

    let authoritySigner = createSignerFromKeypair(umi, {
      secretKey: centralizedAccount.secretKey,
      publicKey: publicKey(centralizedAccount.publicKey),
    });

    umi.use(signerIdentity(authoritySigner));

    // check creation of land merkle tree
    try {
      await fetchMerkleTree(umi, publicKey(landMerkleTree.publicKey));
    } catch (err) {
      if (err.name == AccountNotFoundError.name) {
        await (
          await createTree(umi, {
            merkleTree: createSignerFromKeypair(umi, {
              secretKey: landMerkleTree.secretKey,
              publicKey: publicKey(landMerkleTree.publicKey),
            }),
            maxDepth: 14,
            maxBufferSize: 64,
          })
        ).sendAndConfirm(umi);
      } else {
        throw err;
      }
    }

    // check creation of rental merkle tree
    try {
      await fetchMerkleTree(umi, publicKey(rentalMerkleTree.publicKey));
    } catch (err) {
      if (err.name == AccountNotFoundError.name) {
        await (
          await createTree(umi, {
            merkleTree: createSignerFromKeypair(umi, {
              secretKey: rentalMerkleTree.secretKey,
              publicKey: publicKey(rentalMerkleTree.publicKey),
            }),
            maxDepth: 14,
            maxBufferSize: 64,
            canopyDepth: 7,
          })
        ).sendAndConfirm(umi);
      } else {
        throw err;
      }
    }

    // check if nonce account exists

    let account = await umi.rpc.getAccount(publicKey(nonceAccount.publicKey));

    if (!account.exists) {
      let tx = new anchor.web3.Transaction().add(
        // create nonce account
        SystemProgram.createAccount({
          fromPubkey: centralizedAccount.publicKey,
          newAccountPubkey: nonceAccount.publicKey,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(
            NONCE_ACCOUNT_LENGTH
          ),
          space: NONCE_ACCOUNT_LENGTH,
          programId: SystemProgram.programId,
        }),
        // init nonce account
        SystemProgram.nonceInitialize({
          noncePubkey: nonceAccount.publicKey, // nonce account pubkey
          authorizedPubkey: centralizedAccount.publicKey, // nonce account authority (for advance and close)
        })
      );

      let blockhash = (
        await provider.connection.getLatestBlockhash("finalized")
      ).blockhash;

      tx.recentBlockhash = blockhash;
      tx.feePayer = centralizedAccount.publicKey;

      tx.partialSign(centralizedAccount);
      tx.partialSign(nonceAccount);

      let signature = await provider.connection.sendRawTransaction(
        tx.serialize()
      );

      let txInfo = await validateTxExecution(signature, umi);

      if (txInfo != null) {
        // console.log(txInfo);
      }
    }
  });

  // it("", async () => {
  //   await program.methods
  //     .updateConfig({
  //       baseCost: null,
  //       adminQuota: null,
  //       merkleTreeAddress: rentalMerkleTree.publicKey,
  //       multiplier: null,
  //     })
  //     .accounts({
  //       centralAuthority: centralAuthority,
  //       centralizedAccount: centralizedAccount.publicKey,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //       mintAccount: mintAccount,
  //     })
  //     .signers([centralizedAccount])
  //     .rpc();
  // });

  // it("should prevent initialization twice", async () => {
  //   try {
  //     await program.methods
  //       .initialize()
  //       .accounts({
  //         payer: centralizedAccount.publicKey,
  //         centralAuthority: centralAuthority,
  //         mintAccount: mintAccount,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         rentalMerkleTree: rentalMerkleTree.publicKey,
  //       })
  //       .signers([centralizedAccount])
  //       .rpc();
  //   } catch (err: any) {
  //     if (
  //       err["error"] &&
  //       err["error"]["errorCode"]["code"] == "AlreadyInitialized"
  //     ) {
  //       // console.log(err)
  //     } else {
  //       throw err;
  //     }
  //   }
  // });

  // it("should fail as centralized account didn't call the function", async () => {
  //   try {
  //     await program.methods
  //       .mintRentalToken(Buffer.from(""), [])
  //       .accounts({
  //         centralAuthority: centralAuthority,
  //         centralizedAccount: caller.publicKey,
  //         mint: mintAccount,
  //         centralizedAccountAta,
  //         caller: caller.publicKey,
  //         callerAta,
  //         rentalMerkleTree: rentalMerkleTree.publicKey,
  //         treeConfig: treeConfig,
  //         landMerkleTree: landMerkleTree.publicKey,
  //         bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
  //         logWrapper: SPL_NOOP_PROGRAM_ID,
  //         compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .signers([caller, rentalMerkleTree])
  //       .rpc();
  //   } catch (err: any) {}
  // });

  // it("should fail as improper nft data passed", async () => {
  //   try {
  //     await program.methods
  //       .mintRentalToken(Buffer.from(""), [])
  //       .accounts({
  //         centralAuthority: centralAuthority,
  //         centralizedAccount: centralizedAccount.publicKey,
  //         mint: mintAccount,
  //         centralizedAccountAta,
  //         caller: caller.publicKey,
  //         callerAta: callerAta,
  //         rentalMerkleTree: rentalMerkleTree.publicKey,
  //         treeConfig: treeConfig,
  //         landMerkleTree: landMerkleTree.publicKey,
  //         bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
  //         logWrapper: SPL_NOOP_PROGRAM_ID,
  //         compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  //         systemProgram: anchor.web3.SystemProgram.programId,
  //         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       })
  //       .signers([centralizedAccount, caller])
  //       .rpc();
  //   } catch (err: any) {
  //     console.log(err);
  //     // if (
  //     //   ![
  //     //     "InvalidRemainingAccountsPassed",
  //     //     "InsuffientFunds",
  //     //     "InvalidLandNFTData",
  //     //   ].includes(err["error"]["errorCode"]["code"])
  //     // ) {
  //     //   throw err;
  //     // }
  //   }
  // });

  it("should successfully mint an nft", async () => {
    let land_nfts = [0];

    let leavesData = [];
    let accountsToPass = [];

    for (let nft_index of land_nfts) {
      const [assetId, bump] = findLeafAssetIdPda(umi, {
        merkleTree: publicKey(landMerkleTree.publicKey),
        leafIndex: nft_index,
      });

      let assetWithProof;

      try {
        assetWithProof = await getAssetWithProof(umi, assetId);
      } catch (err) {
        // ensure it's created for test purposes!
        if (err.message.includes("Asset not found")) {
          await mintV1(umi, {
            leafOwner: publicKey(landOwner),
            merkleTree: publicKey(landMerkleTree.publicKey),
            metadata: {
              name: "Land NFT",
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
            },
          }).sendAndConfirm(umi);

          assetWithProof = await getAssetWithProof(umi, assetId);
        }
      }

      let owner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

      let leafData = {
        leafIndex: new anchor.BN(assetWithProof.index),
        leafNonce: new anchor.BN(assetWithProof.nonce),
        owner,
        delegate:
          assetWithProof.leafDelegate != null
            ? new anchor.web3.PublicKey(assetWithProof.leafDelegate)
            : owner,
        root: new anchor.web3.PublicKey(assetWithProof.root),
        leafHash: [
          ...new anchor.web3.PublicKey(
            assetWithProof.rpcAssetProof.leaf.toString()
          ).toBytes(),
        ],
        leafMetadata: Buffer.from(
          getMetadataArgsSerializer().serialize(assetWithProof.metadata)
        ),
      };

      leavesData.push(leafData);

      // Push Owner
      accountsToPass.push({
        pubkey: owner,
        isSigner: false,
        isWritable: true,
      });

      let owner_ata = getAssociatedTokenAddressSync(mintAccount, owner);

      accountsToPass.push({
        pubkey: owner_ata,
        isSigner: false,
        isWritable: true,
      });
    }

    let collectionMint = new PublicKey(
      "94pbP1FULSAFPk9BVhKA7NHG62ijCtQkGyXvQsxaYvDr"
    );

    let offChainMetadata = {
      name: "RENTAL NFT",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/sky-trade-logo.svg",
      external_url: "https://sky.trade/",
      metadata:{
        
      }
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
        key: publicKey(collectionMint),
        verified: true,
      },
      tokenProgramVersion: TokenProgramVersion.Original,
      tokenStandard: TokenStandard.NonFungible,
    });

    let centralAuthorityInfo = await program.account.data.fetch(
      centralAuthority
    );

    let feeAccountAta = await getAssociatedTokenAddress(
      mintAccount,
      centralAuthorityInfo.feeAccount
    );

    let [collectionMetadata] = findMetadataPda(umi, {
      mint: publicKey(collectionMint),
    });

    let [collectionEdition] = findMasterEditionPda(umi, {
      mint: publicKey(collectionMint),
    });

    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      // `collection_cpi` is a custom prefix required by the Bubblegum program
      [Buffer.from("collection_cpi", "utf8")],
      new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
    );

    const [assetId, bump] = findLeafAssetIdPda(umi, {
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      leafIndex: 0,
    });

    await mintV1(umi, {
      leafOwner: publicKey("CVd7KmcbcqyUrNV55m3QJno3BShVef7JBoRJ6XQHyxXR"),
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      // collectionMint: publicKey(collectionMint),
      metadata: {
        name: "My Compressed NFT",
        uri: `ipfs://${cid}/`,
        sellerFeeBasisPoints: 500, // 5%
        collection: { key: publicKey(collectionMint), verified: false },
        creators: [
          { address: umi.identity.publicKey, verified: false, share: 100 },
        ],
      },
    }).sendAndConfirm(umi);

    console.log(assetId);

    const rpcAsset = await umi.rpc.getAsset(assetId);

    console.log(rpcAsset.content.json_uri)
    // const rpcAssetProof = await umi.rpc.getAssetProof(assetId);

    // let callersigner = createSignerFromKeypair(umi, {
    //   secretKey: caller.secretKey,
    //   publicKey: publicKey(caller.publicKey),
    // });

    // umi.use(signerIdentity(callersigner));

    // await transfer(umi, {
    //   leafOwner: callersigner,
    //   newLeafOwner: publicKey("ET2tp4QKrtynC4jUKhzbxis4Pop2pqNWhNx9N46NSVqr"),
    //   merkleTree: rpcAssetProof.tree_id,
    //   root: publicKeyBytes(rpcAssetProof.root),
    //   dataHash: publicKeyBytes(rpcAsset.compression.data_hash),
    //   creatorHash: publicKeyBytes(rpcAsset.compression.creator_hash),
    //   nonce: rpcAsset.compression.leaf_id,
    //   index: rpcAssetProof.node_index - 2 ** rpcAssetProof.proof.length,
    //   proof: rpcAssetProof.proof,
    // }).sendAndConfirm(umi);

    // let ix = await program.methods
    //   .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
    //   .accounts({
    //     centralAuthority: centralAuthority,
    //     centralizedAccount: centralizedAccount.publicKey,
    //     mint: mintAccount,
    //     centralizedAccountAta,
    //     caller: caller.publicKey,
    //     callerAta: callerAta,
    //     rentalMerkleTree: rentalMerkleTree.publicKey,
    //     treeConfig: treeConfig,
    //     landMerkleTree: landMerkleTree.publicKey,
    //     bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
    //     logWrapper: SPL_NOOP_PROGRAM_ID,
    //     compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    //     systemProgram: anchor.web3.SystemProgram.programId,
    //     associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    //     tokenProgram: TOKEN_PROGRAM_ID,
    //     collectionMint,
    //     collectionMetadata,
    //     collectionEdition,
    //     bubblegumSigner,
    //     tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
    //     feeAccountAta,
    //   })
    //   .remainingAccounts(accountsToPass)
    //   .instruction();

    // let [tx, nonceBlock] = await createTxWithNonce(
    //   provider.connection,
    //   nonceAccount.publicKey,
    //   centralizedAccount.publicKey
    // );

    // let tx = new Transaction();

    // tx = tx.add(ix);

    // let blockhash = (await provider.connection.getLatestBlockhash("finalized"))
    //   .blockhash;

    // // tx.recentBlockhash = nonceBlock.nonce;
    // tx.recentBlockhash = blockhash;
    // tx.feePayer = centralizedAccount.publicKey;

    // // caller

    // tx.sign(caller);
    // tx.partialSign(centralizedAccount);
    // // tx.partialSign(bubblegumSigner)

    // console.log(getTxSize(tx, centralizedAccount.publicKey));

    // // await sleep(90 * 1000);

    // // sign with nonce

    // let mintSx;

    // try {
    //   mintSx = await provider.connection.sendRawTransaction(tx.serialize());
    // } catch (err) {
    //   console.log(err);
    // }

    // let mintTxInfo;

    // let i = 0;

    // while (i < 6) {
    //   const tx0 = await umi.rpc.getTransaction(decode(mintSx), {
    //     commitment: "confirmed",
    //   });

    //   if (tx0 !== null) {
    //     mintTxInfo = tx0;
    //     break;
    //   }

    //   await sleep(1000 * i);

    //   i++;
    // }

    // let [leafIndex] = findLeafIndexFromAnchorTx(mintTxInfo);

    // let [assetId] = findLeafAssetIdPda(umi, {
    //   merkleTree: publicKey(rentalMerkleTree.publicKey),
    //   leafIndex: leafIndex,
    // });

    // createdLeafIndex = leafIndex;

    // let rentalAsset = await umi.rpc.getAsset(assetId);

    // assert.equal(
    //   rentalAsset.ownership.owner.toString(),
    //   caller.publicKey.toString()
    // );
  });

  // it("should transfer rental nft to another", async () => {
  //   // leaf index = 33
  //   let [assetId] = findLeafAssetIdPda(umi, {
  //     merkleTree: publicKey(rentalMerkleTree.publicKey),
  //     leafIndex: createdLeafIndex,
  //   });

  //   const assetWithProof = await getAssetWithProof(umi, assetId);

  //   let owner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

  //   let leafData = {
  //     leafIndex: assetWithProof.index,
  //     leafNonce: new anchor.BN(assetWithProof.nonce),
  //     owner,
  //     delegate:
  //       assetWithProof.leafDelegate != null
  //         ? new anchor.web3.PublicKey(assetWithProof.leafDelegate)
  //         : owner,
  //     root: new anchor.web3.PublicKey(assetWithProof.root),
  //     leafHash: [
  //       ...new anchor.web3.PublicKey(
  //         assetWithProof.rpcAssetProof.leaf.toString()
  //       ).toBytes(),
  //     ],
  //     leafMetadata: Buffer.from(
  //       getMetadataArgsSerializer().serialize(assetWithProof.metadata)
  //     ),
  //   };

  //   let acc = await ConcurrentMerkleTreeAccount.fromAccountAddress(
  //     provider.connection,
  //     rentalMerkleTree.publicKey
  //   );

  //   let canopyDepth = acc.getCanopyDepth();

  //   const proofs = assetWithProof.proof
  //     .slice(0, assetWithProof.proof.length - (!!canopyDepth ? canopyDepth : 0))
  //     .map((node) => ({
  //       pubkey: new anchor.web3.PublicKey(node),
  //       isSigner: false,
  //       isWritable: false,
  //     }));

  //   await program.methods
  //     .transferRentalToken(leafData)
  //     .accounts({
  //       centralAuthority,
  //       centralizedAccount: centralizedAccount.publicKey,
  //       sender: caller.publicKey,
  //       rentalMerkleTree: rentalMerkleTree.publicKey,
  //       receiver: receiver.publicKey,
  //       treeConfig,
  //       bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
  //       logWrapper: SPL_NOOP_PROGRAM_ID,
  //       compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //     })
  //     .signers([centralizedAccount, caller])
  //     .remainingAccounts(proofs)
  //     .rpc();

  //   const asset = await umi.rpc.getAsset(assetId);

  //   assert.equal(
  //     asset.ownership.owner.toString(),
  //     receiver.publicKey.toString()
  //   );
  // });
});
