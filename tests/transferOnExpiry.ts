import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
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
  Connection,
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

const landAssetId = new PublicKey(
  "7gyD7j1seeJAWrh24HvC6fxXWcXGjuseUzsmkooNt99d"
);

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
  const caller = centralizedAccount

  const centralizedAccountAta = getAssociatedTokenAddressSync(
    mintAccount,
    centralizedAccount.publicKey
  );

  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

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


  it("should successfully pay the rental after expiry", async () => {
    let land_nfts = [0];

    let leavesData = [];
    let accountsToPass = [];

    let assetWithProof = await getAssetWithProof(
      umi,
      publicKey(landAssetId.toString())
    );


    let collectionMint = new PublicKey(
      "94pbP1FULSAFPk9BVhKA7NHG62ijCtQkGyXvQsxaYvDr"
    );


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


    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });


    umi.use(signerIdentity(callersigner));


    
  
    let dateNow = "2024-08-29T13:40:08.072Z";//'2024-08-26T19:25:12.738Z'
console.log({dateNow})
    
    let [rent_escrow,bump]=anchor.web3.PublicKey.findProgramAddressSync([landAssetId.toBytes(),Buffer.from(dateNow)],program.programId)
    
    const rent_escrow_Ata = associatedAddress({ mint: mintAccount, owner: rent_escrow });
   
     let leavesDataLength =new anchor.BN(leavesData.length)
     
    let ans=await program.account.rentEscrow.fetch(rent_escrow)


      const proofLen = assetWithProof.proof.length;

      const canopyDepth = await getCanopyDepth(
        provider.connection,
        new PublicKey(assetWithProof.merkleTree)
      );
        
      const proof = assetWithProof.proof
        .map((node) => ({
          pubkey: new PublicKey(node),
          isSigner: false,
          isWritable: false,
        }))
        .slice(0, proofLen - canopyDepth);

    const { dataHash: hash, creatorHash, index, nonce, root } = assetWithProof;
    const { leafOwner, leafDelegate } = assetWithProof
        
    //TODO check if it leafOwner is owned by ah program
    const leafOwnerData = await provider.connection.getAccountInfo(new PublicKey(leafOwner))


    let paymentReceiver: PublicKey
    if (leafOwnerData.owner == SYSTEM_PROGRAM_ID) {
      console.log("land not in auction")
      paymentReceiver = new PublicKey(leafOwner)
    } else if (leafOwnerData.owner.toString() == process.env.AH_PROGRAM_ADDRESS) {
      console.log("land in auction")

      let discriminatorAndOthers = 8 + 10 + 32 + 32 + 8 + 8

      paymentReceiver = new PublicKey(
        leafOwnerData.data.slice(
          discriminatorAndOthers,
          discriminatorAndOthers + 32
        ))
      
      console.log("auction creator is", paymentReceiver.toString())
    } else {
      throw new Error("Invalid leaf owner");
    }
    const paymentReceiverAta = associatedAddress({ mint: mintAccount, owner: paymentReceiver })

    let ix = await program.methods
      .transferOnExpiry({
        hash: Array.from(hash),
        creatorHash: Array.from(creatorHash),
        index,
        nonce: new BN(nonce),
        root: Array.from(root),
      })
      .accountsStrict({
        payer: caller.publicKey,
        mint: mintAccount,
        feeAccount,
        feeAccountAta: feeAccountAta.address,
        landOwner: new PublicKey(leafOwner),
        landDelegate: new PublicKey(leafDelegate),
        paymentReceiverAta: paymentReceiverAta,
        paymentReceiver: paymentReceiver,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
        rentEscrow: rent_escrow,
        rentEscrowAta: rent_escrow_Ata,
        compressionProgram: new PublicKey(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID),
        merkleTree: assetWithProof.merkleTree,
      })
      .remainingAccounts(proof)
      .instruction();
  
      let tx = new Transaction();
      tx = tx.add(ix);
  
     /*  let blockhash = (await connection.getLatestBlockhash("finalized"))
        .blockhash;
        tx.recentBlockhash = blockhash;
        tx.feePayer = localKp.publicKey; */
      
        let sig=await sendAndConfirmTransaction(provider.connection,tx,[caller]).catch((e)=>{
            console.log(e)
        })
  
        //let escrowPda=await program.account.escrow.fetch(escrowAddress)
      console.log("Create escrow transaction signature", sig);
   });


});

const getCanopyDepth = async (
  connection: Connection,
  merkleTree: PublicKey
) => {
  const splCMT = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    merkleTree
  );
  return splCMT.getCanopyDepth();
};
