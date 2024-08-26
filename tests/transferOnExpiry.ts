import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import crypto from "crypto"
import {
    createNonceIx,
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
import "dotenv/config"
import {
  LAMPORTS_PER_SOL,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
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
import "dotenv/config"
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { associatedAddress } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { utf8 } from "@metaplex-foundation/umi/serializers";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
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
  let mintAccEnv=process.env.MINT_ACCOUNT_ADDRESS
  const mintAccount = new anchor.web3.PublicKey(
    mintAccEnv
  );

  // DiW5MWFjPR3AeVd28ChEhsGb96efhHwst9eYwy8YdWEf
  const centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  console.log(centralizedAccount.publicKey);

  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));
  // caZUFsSZLD8VK8q652FZm3nZWqq4HFncr4pix8sckYb
  const caller = loadKeyPair(join(__dirname,"../wallets/devnet-keys/caller.json"));

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
const nonceEnv=process.env.NONCE_ACCOUNT
  const nonceAccount = loadKeyPair(nonceEnv);

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
    console.log({nonceAcc:account.publicKey})
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
      console.log({nonceCreationSIg:signature})
      let txInfo = await validateTxExecution(signature, umi);

      if (txInfo != null) {
         console.log(txInfo);
      }
    }
  });


  it("should successfully mint an nft", async () => {
    let land_nfts = [0];

    let leavesData = [];
    let accountsToPass = [];

    for (let nft_index of land_nfts) {
      const [assetId, bump] = findLeafAssetIdPda(umi, {
        merkleTree: publicKey(landMerkleTree.publicKey),
        leafIndex: nft_index,
      });
      console.log({assetId})
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
console.log({centralAuthorityInfo
})
let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);
    let feeAccountAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount,
      feeAccount
    );
    console.log({feeAccountAta})

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

/*     const [rentalassetId, bump] = findLeafAssetIdPda(umi, {
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      leafIndex: 37,
    });
console.log("----------------------------")

    console.log({rentalassetId});
    const rpcAsset = await umi.rpc.getAsset(rentalassetId); */
    let merkleTreeAc= await fetchMerkleTree(umi,  publicKey(rentalMerkleTree.publicKey));
    //console.log({merkleTreeAc})
    //console.log({rpcAsset})
    //const rpcAssetProof = await getAssetWithProof(umi,publicKey(rentalassetId));

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });


    umi.use(signerIdentity(callersigner));

    
    const seeds = []
    
  
    let landAssetId=new PublicKey("Gg1xbHzW1zdzCgLjMAAxaTHsg4zRaTnnZat2go6ERYc8");
    let dateNow='2024-08-26T20:29:32.011Z';//'2024-08-26T19:25:12.738Z'
console.log({dateNow})
    
    let [rent_escrow,bump]=anchor.web3.PublicKey.findProgramAddressSync([landAssetId.toBytes(),Buffer.from(dateNow)],program.programId)
    
    const rent_escrow_Ata = associatedAddress({ mint: mintAccount, owner: rent_escrow });
   
     let leavesDataLength =new anchor.BN(leavesData.length)
    console.log({caller:caller.publicKey})
     
    let ans=await program.account.rentEscrow.fetch(rent_escrow)

    console.log(ans)



    let ix = await program.methods.transferOnExpiry(landAssetId,dateNow,bump).accountsStrict({
        payer:caller.publicKey,
        payerAta:callerAta,
        mint:mintAccount,
        feeAccount,
        feeAccountAta:feeAccountAta.address,
        landOwner:caller.publicKey,
        landOwnerAta:callerAta,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
             tokenProgram: TOKEN_PROGRAM_ID,        
        systemProgram:SYSTEM_PROGRAM_ID,
        rentEscrow:rent_escrow,
        rentEscrowAta:rent_escrow_Ata,
      }).instruction()
  
      let tx = new Transaction();
      tx = tx.add(ix);
  
     /*  let blockhash = (await connection.getLatestBlockhash("finalized"))
        .blockhash;
        tx.recentBlockhash = blockhash;
        tx.feePayer = localKp.publicKey; */
  
       
      
        console.log({txsize:getTxSize(tx, caller.publicKey)});
        let sig=await sendAndConfirmTransaction(provider.connection,tx,[caller]).catch((e)=>{
            console.log(e)
        })
  
        //let escrowPda=await program.account.escrow.fetch(escrowAddress)
      console.log("Create escrow transaction signature", sig);
      
  
      
     
   });


});

