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

(async () => {
  // for creation of a billion cnfts
  // refer to https://developers.metaplex.com/bubblegum/create-trees
  // should cost an estimated 4.0291818 SOL x2 (as there are two merkle trees, bring total to just over 8 SOL)
  let merkleTreeBufferSize = 512;
  let merkleTreeDepth = 30;
  let merkleTreeCanopyDepth = 10;

  // input private key here
  let centralizedAccount = loadKeyPairV2([
    56, 61, 247, 11, 193, 208, 236, 49, 187, 199, 168, 206, 46, 86, 98, 54, 205,
    192, 7, 236, 14, 201, 71, 162, 238, 68, 157, 29, 70, 173, 188, 142, 188,
    237, 238, 122, 255, 159, 223, 107, 67, 85, 141, 90, 134, 203, 70, 42, 167,
    235, 151, 213, 48, 215, 222, 69, 41, 245, 129, 143, 239, 118, 136, 28,
  ]);

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

  const rentalMerkleTree = loadKeyPair(
    join(__dirname, "../tests", "wallets/rentalMerkleTree.json")
  );

  const landMerkleTree = loadKeyPair(
    join(__dirname, "../tests", "wallets/landMerkleTree.json")
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
