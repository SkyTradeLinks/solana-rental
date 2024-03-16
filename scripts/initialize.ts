import * as anchor from "@coral-xyz/anchor";
import { loadKeyPair, loadKeyPairV2, validateTxExecution } from "../helper";
import {
  Connection,
  NONCE_ACCOUNT_LENGTH,
  SystemProgram,
} from "@solana/web3.js";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createTree,
  fetchMerkleTree,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  AccountNotFoundError,
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import "dotenv/config";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";

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
  const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

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
  const mintAccount = new anchor.web3.PublicKey(
    process.env.MINT_ACCOUNT_ADDRESS
  );

  // create merkle trees

  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

  const nonceAccount = loadKeyPair(process.env.NONCE_ACCOUNT);

  let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);

  // needs to have ata address (USDC) before assigning as fee Account
  await getOrCreateAssociatedTokenAccount(
    provider.connection,
    centralizedAccount,
    mintAccount,
    feeAccount
  );

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
          maxDepth: merkleTreeDepth,
          maxBufferSize: merkleTreeBufferSize,
          canopyDepth: merkleTreeCanopyDepth,
        })
      ).sendAndConfirm(umi);
    } else {
      throw err;
    }
  }

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
          maxDepth: merkleTreeDepth,
          maxBufferSize: merkleTreeBufferSize,
          canopyDepth: merkleTreeCanopyDepth,
        })
      ).sendAndConfirm(umi);
    } else {
      throw err;
    }
  }

  try {
    await program.methods
      .initialize()
      .accounts({
        payer: centralizedAccount.publicKey,
        centralAuthority: centralAuthority,
        mintAccount: mintAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        feeAccount,
      })
      .signers([centralizedAccount])
      .rpc();
  } catch (err) {
    console.log(err);
  }

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

    let blockhash = (await provider.connection.getLatestBlockhash("finalized"))
      .blockhash;

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

  console.log("successfully initialized ");
})();
