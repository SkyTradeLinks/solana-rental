import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import { loadKeyPair } from "../helper";
import {
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  mplBubblegum,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  getAssetWithProof,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import "dotenv/config";
import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";

import "dotenv/config";

import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";

import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import "dotenv/config";
import { associatedAddress } from "@coral-xyz/anchor/dist/cjs/utils/token";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";

const landAssetId = new PublicKey(
  "HD6m5GvQRaugE6a4ZAzqL5hB3GqMYLeVvw5CAYktkca4"
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
  let mintAccEnv = process.env.MINT_ACCOUNT_ADDRESS;
  const mintAccount = new anchor.web3.PublicKey(mintAccEnv);

  // DiW5MWFjPR3AeVd28ChEhsGb96efhHwst9eYwy8YdWEf
  const centralizedAccount = loadKeyPair(process.env.CENTRALIZED_ACCOUNT);

  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));
  // caZUFsSZLD8VK8q652FZm3nZWqq4HFncr4pix8sckYb
  const caller = centralizedAccount;

  it("should successfully pay the rental after expiry", async () => {
    let leavesData = [];

    let assetWithProof = await getAssetWithProof(
      umi,
      publicKey(landAssetId.toString())
    );

    let centralAuthorityInfo = await program.account.data.fetch(
      centralAuthority
    );
    let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);
    let feeAccountAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount,
      feeAccount
    );

    let callersigner = createSignerFromKeypair(umi, {
      secretKey: caller.secretKey,
      publicKey: publicKey(caller.publicKey),
    });

    umi.use(signerIdentity(callersigner));

    let dateNow = "2024-09-02T03:30:14.986Z"; //'2024-08-26T19:25:12.738Z'
    console.log({ dateNow });

    let [rent_escrow, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), landAssetId.toBytes(), Buffer.from(dateNow)],
      program.programId
    );

    const rent_escrow_Ata = associatedAddress({
      mint: mintAccount,
      owner: rent_escrow,
    });

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
    const { leafOwner, leafDelegate } = assetWithProof;

    //TODO check if it leafOwner is owned by ah program
    const leafOwnerData = await provider.connection.getAccountInfo(
      new PublicKey(leafOwner)
    );

    let paymentReceiver: PublicKey;

    if (leafOwnerData.owner.toString() == SYSTEM_PROGRAM_ID.toString()) {
      console.log("land not in auction");
      paymentReceiver = new PublicKey(leafOwner);
    } else if (
      leafOwnerData.owner.toString() == process.env.AH_PROGRAM_ADDRESS
    ) {
      console.log("land in auction");

      let dataBeforeSeller = 8 + 10 + 32 + 32 + 8 + 8;

      paymentReceiver = new PublicKey(
        leafOwnerData.data.slice(dataBeforeSeller, dataBeforeSeller + 32)
      );

      console.log("auction creator is", paymentReceiver.toString());
    } else {
      throw new Error("Invalid leaf owner");
    }
    const paymentReceiverAta = associatedAddress({
      mint: mintAccount,
      owner: paymentReceiver,
    });

    let ix = await program.methods
      .transferOnExpiry({
        hash: Array.from(hash),
        creatorHash: Array.from(creatorHash),
        index,
        nonce: new BN(nonce),
        root: Array.from(root),
      })
      .accountsStrict({
        centralAuthority,
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

    let sig = await sendAndConfirmTransaction(provider.connection, tx, [
      caller,
    ]).catch((e) => {
      console.log(e);
    });

    console.log("transfer on expiry transaction signature", sig);
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
