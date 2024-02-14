 import { LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
import { TransactionWithMeta } from "@metaplex-foundation/umi";
import {
  MPL_BUBBLEGUM_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import { deserializeChangeLogEventV1 } from "@solana/spl-account-compression";

export const setupAirDrop = async (
  provider: anchor.AnchorProvider,
  accounts: anchor.web3.Keypair[]
) => {
  const latestBlockHash = await provider.connection.getLatestBlockhash();

  for (let account of accounts) {
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: await provider.connection.requestAirdrop(
        account.publicKey,
        LAMPORTS_PER_SOL * 1000
      ),
    });
  }
};

export const loadKeyPair = (filename) => {
  const decodedKey = new Uint8Array(
    JSON.parse(fs.readFileSync(filename).toString())
  );

  let keyPair = Keypair.fromSecretKey(decodedKey);

  return keyPair;
};

export const findLeafIndexFromMetaplexTx = (txInfo: TransactionWithMeta) => {
  let leafIndex: number | undefined = undefined;

  const relevantIndex = txInfo!.message.instructions.findIndex(
    (instruction) => {
      return (
        txInfo?.message.accounts[instruction.programIndex].toString() ===
        MPL_BUBBLEGUM_PROGRAM_ID.toString()
      );
    }
  );

  const relevantInnerIxs = txInfo!.meta.innerInstructions[
    relevantIndex
  ].instructions.filter((instruction) => {
    return (
      txInfo?.message.accounts[instruction.programIndex].toString() ===
      SPL_NOOP_PROGRAM_ID.toString()
    );
  });

  for (let i = relevantInnerIxs.length - 1; i > 0; i--) {
    try {
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(relevantInnerIxs[i]?.data!)
      );

      leafIndex = changeLogEvent?.index;
    } catch (__) {
      // do nothing, invalid data is handled just after the for loop
    }
  }

  return leafIndex;
};

export const findLeafIndexFromAnchorTx = (txInfo: TransactionWithMeta) => {
  let leafIndex: number | undefined = undefined;
  let treeAddress;

  let innerInstructions = txInfo.meta.innerInstructions;

  for (let i = innerInstructions.length - 1; i >= 0; i--) {
    for (let j = innerInstructions[i].instructions.length - 1; j >= 0; j--) {
      const instruction = innerInstructions[i].instructions[j];

      const programId = txInfo.message.accounts[instruction.programIndex];

      if (programId.toString() == SPL_NOOP_PROGRAM_ID.toString()) {
        try {
          const changeLogEvent = deserializeChangeLogEventV1(
            Buffer.from(instruction.data)
          );

          leafIndex = changeLogEvent?.index;
          treeAddress = changeLogEvent?.treeId;
        } catch (__) {
          // do nothing, invalid data is handled just after the for loop
        }
      }
    }
  }

  //
  return [leafIndex, treeAddress];
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const loadKeyPairV2 = (key) => {
  const decodedKey = new Uint8Array(JSON.parse(key));

  let keyPair = Keypair.fromSecretKey(decodedKey);

  return keyPair;
};
