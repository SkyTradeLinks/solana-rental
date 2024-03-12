import * as anchor from "@coral-xyz/anchor";
import { loadKeyPair, loadKeyPairV2 } from "../helper";
import { Connection } from "@solana/web3.js";
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
import { join } from "path";
import "dotenv/config";

(async () => {
  // for creation of a billion cnfts
  // refer to https://developers.metaplex.com/bubblegum/create-trees
  // should cost an estimated 4.0291818 SOL x2 (as there are two merkle trees, bring total to just over 8 SOL)
  let merkleTreeBufferSize = 512;
  let merkleTreeDepth = 30;
  let merkleTreeCanopyDepth = 10;

  // input private key here
  let centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  const wallet = new anchor.Wallet(centralizedAccount);

  // input connection uri
  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=887524e6-92b0-4f96-973c-b37a53a9cfe4"
  );

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

  // data pda
  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  // input mint account
  const mintAccount = new anchor.web3.PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  );

  // create merkle trees

  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

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

  await program.methods
    .initialize()
    .accounts({
      payer: centralizedAccount.publicKey,
      centralAuthority: centralAuthority,
      mintAccount: mintAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
      rentalMerkleTree: rentalMerkleTree.publicKey,
    })
    .signers([centralizedAccount])
    .rpc();
})();
