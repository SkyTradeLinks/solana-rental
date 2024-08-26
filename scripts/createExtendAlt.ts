import * as anchor from "@coral-xyz/anchor";
import {
  getPriorityFeeIx,
  loadKeyPair,
  pinFilesToIPFS,
  sendTx,
  validateTxExecution,
} from "../helper";
import {
    TokenProgramVersion,
    TokenStandard,
    
    findTreeConfigPda,
    mintV1,
   
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
    AddressLookupTableProgram,
  Connection,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createTree,
  fetchMerkleTree,
  mplBubblegum,
  MPL_BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  AccountNotFoundError,
  createSignerFromKeypair,
  percentAmount,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import "dotenv/config";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  createNft,
  mplTokenMetadata,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  findMasterEditionPda,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";
import { deserializeChangeLogEventV1 } from "@solana/spl-account-compression";

(async () => {
  // for creation of a billion cnfts
  // refer to https://developers.metaplex.com/bubblegum/create-trees
  // should cost an estimated 4.0291818 SOL x2 (as there are two merkle trees, bring total to just over 8 SOL)
  let merkleTreeBufferSize = parseInt(process.env.MERKLE_TREE_BUFFER_SIZE);
  let merkleTreeDepth = parseInt(process.env.MERKLE_TREE_DEPTH);
  let merkleTreeCanopyDepth = parseInt(process.env.MERKLE_TREE_CANOPY_DEPTH);

  // input private key here
  let centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  const wallet = new anchor.Wallet(centralizedAccount);

  // input connection uri
  const connection = new Connection(process.env.CONNECTION_URI);

  const provider = new anchor.AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // setup umi
  const umi = createUmi(provider.connection.rpcEndpoint)
    .use(mplBubblegum())
    .use(mplTokenMetadata());

  // doubles as a collectionUpdateAuthority
  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));

  // setup program
  const program = anchor.workspace
    .SolanaSkyTrade as anchor.Program<SolanaSkyTrade>;

  console.log(program.programId); // No idea why, but this line is important. Otherwise, the script breaks...

  // data pda
  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  // input mint account
 
  // create merkle trees
  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

  const nonceAccount = loadKeyPair(process.env.NONCE_ACCOUNT);

  let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);

  let rentalCollectionMint = loadKeyPair(process.env.RENTAL_COLLECTION_MINT);

  let landCollectionMint = loadKeyPair(process.env.LAND_COLLECTION_MINT);

  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    // `collection_cpi` is a custom prefix required by the Bubblegum program
    [Buffer.from("collection_cpi", "utf8")],
    new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
  );

await ExtendMerkleTreeIx(umi,connection,centralizedAccount)

})();

async function  createMerkleTreeIx(connection:Connection,payer:Keypair,address:Array<any>){
    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
        // `collection_cpi` is a custom prefix required by the Bubblegum program
        [Buffer.from("collection_cpi", "utf8")],
        new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
      );
    const slot = await connection.getSlot()

    // get the latest block (allowing for v0 transactions)
const block = await connection.getBlock(slot, {
    maxSupportedTransactionVersion: 0,
  });

  let minRent = await connection.getMinimumBalanceForRentExemption(0);

  let bh = await connection
  .getLatestBlockhash()

  let blockhash=bh.blockhash;

    const [lookupTableInst, lookupTableAddress] =AddressLookupTableProgram.createLookupTable({
        authority: payer.publicKey,
        payer: payer.publicKey,
        recentSlot: slot,
    });


    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: lookupTableAddress,
        addresses: [bubblegumSigner,new PublicKey(SPL_NOOP_PROGRAM_ID),new PublicKey(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID),anchor.web3.SystemProgram.programId, ASSOCIATED_TOKEN_PROGRAM_ID,TOKEN_PROGRAM_ID, new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID)],
      });
    

    

    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions:[lookupTableInst,extendInstruction],
      }).compileToV0Message();

    let tx=new VersionedTransaction(messageV0);

    tx.sign([payer]);

    const txId = await connection.sendTransaction(tx);
console.log(`https://explorer.solana.com/tx/${txId}?cluster=devnet`);
console.log("lookup table address:", lookupTableAddress.toBase58());
    

}

async function  ExtendMerkleTreeIx(umi,connection:Connection,payer:Keypair){

    const slot = await connection.getSlot()

    // get the latest block (allowing for v0 transactions)
const block = await connection.getBlock(slot, {
    maxSupportedTransactionVersion: 0,
  });

    let bh = await connection
  .getLatestBlockhash()

  let blockhash=bh.blockhash;

  let AltAddress=new PublicKey("62wUn5TNA7UM1MRUNsovi18oR5CvwpPhAysAWu9PzsfR")

  let collectionMint = new PublicKey(
    "94pbP1FULSAFPk9BVhKA7NHG62ijCtQkGyXvQsxaYvDr"
  );

          let [collectionEdition] = findMasterEditionPda(umi, {
            mint: publicKey(collectionMint),
          });

          let [collectionMetadata] = findMetadataPda(umi, {
            mint: publicKey(collectionMint),
          });
          const mintAccount = new anchor.web3.PublicKey(
            process.env.MINT_ACCOUNT_ADDRESS
          );
        
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: payer.publicKey,
        authority: payer.publicKey,
        lookupTable: AltAddress,
        addresses: [mintAccount,new PublicKey(collectionMetadata),new PublicKey(collectionEdition),collectionMint],
      });
    

    

    const messageV0 = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions:[extendInstruction],
      }).compileToV0Message();

    let tx=new VersionedTransaction(messageV0);

    tx.sign([payer]);

    const txId = await connection.sendTransaction(tx);
console.log(`https://explorer.solana.com/tx/${txId}?cluster=devnet`);


}