import * as anchor from "@coral-xyz/anchor";
import { loadKeyPair, loadKeyPairV2, validateTxExecution } from "../helper";
import { Connection } from "@solana/web3.js";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import "dotenv/config";

async () => {
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

  // data pda
  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  // input mint account
  const mintAccount = new anchor.web3.PublicKey(
    process.env.MINT_ACCOUNT_ADDRESS
  );

  let baseCost = null;

  if (parseInt(process.env.NEW_PRICE)) {
    baseCost = new anchor.BN(parseInt(process.env.NEW_PRICE));
  }

  let adminQuota = null;

  if (parseFloat(process.env.ADMIN_QUOTA)) {
    adminQuota = parseFloat(process.env.ADMIN_QUOTA);
  }

  let newMerkleTree = null;

  if (process.env.NEW_MERKLE_TREE) {
    try {
      newMerkleTree = new anchor.web3.PublicKey(process.env.NEW_MERKLE_TREE);
    } catch (err) {
      throw "Invalid Address Provided";
    }
  }

  await program.methods
    .updateConfig({
      baseCost,
      adminQuota,
      merkleTreeAddress: newMerkleTree,
      multiplier: null,
    })
    .accounts({
      centralAuthority: centralAuthority,
      centralizedAccount: centralizedAccount.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      mintAccount: mintAccount,
    })
    .signers([centralizedAccount])
    .rpc();
};
