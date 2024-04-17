import {
  LAMPORTS_PER_SOL,
  Keypair,
  SystemProgram,
  NonceAccount,
  ComputeBudgetProgram,
  Transaction,
  PublicKey,
  TransactionInstruction,
  Connection,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";
import {
  Signer,
  TransactionWithMeta,
  Umi,
  publicKey,
} from "@metaplex-foundation/umi";
import {
  MPL_BUBBLEGUM_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import { deserializeChangeLogEventV1 } from "@solana/spl-account-compression";
import { decode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/bs58";
import { NFTStorage, File } from "nft.storage";
import {
  createNft,
  mplTokenMetadata,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  fetchMetadataFromSeeds,
  updateV1,
  Metadata,
  MetadataAccountDataArgs,
} from "@metaplex-foundation/mpl-token-metadata";
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

export const loadKeyPair = (filename: string) => {
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
  const decodedKey = new Uint8Array(
    typeof key == "string" ? JSON.parse(key) : key
  );

  let keyPair = Keypair.fromSecretKey(decodedKey);

  return Keypair;
};

export const validateTxExecution = async (signature: string, umi: Umi) => {
  let i = 0;

  while (i < 10) {
    const tx0 = await umi.rpc.getTransaction(decode(signature), {
      commitment: "confirmed",
    });

    if (tx0 !== null) {
      return tx0;
    }

    await sleep(1000 * i);

    i++;
  }

  return null;
};

export const createTxWithNonce = async (
  connection: anchor.web3.Connection,
  nonceAccountPubkey: anchor.web3.PublicKey,
  centralizedAccountPubkey: anchor.web3.PublicKey
): Promise<[anchor.web3.Transaction, NonceAccount]> => {
  let nonceAccountInfo = await connection.getAccountInfo(nonceAccountPubkey);
  let nonceAccount = NonceAccount.fromAccountData(nonceAccountInfo.data);

  let tx = new anchor.web3.Transaction().add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonceAccountPubkey,
      authorizedPubkey: centralizedAccountPubkey,
    })
  );

  return [tx, nonceAccount];
};

export const getPriorityFeeIx = async (connection: anchor.web3.Connection) => {
  let fees = await connection.getRecentPrioritizationFees();
  let maxPrioritizationFee = fees.reduce((max, cur) => {
    return cur.prioritizationFee > max.prioritizationFee ? cur : max;
  }, fees[0]);

  const PRIORITY_FEE_IX = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: maxPrioritizationFee.prioritizationFee,
  });

  return PRIORITY_FEE_IX;
};

export const getTxSize = (tx: Transaction, feePayer: PublicKey): number => {
  const feePayerPk = [feePayer.toBase58()];

  const signers = new Set<string>(feePayerPk);
  const accounts = new Set<string>(feePayerPk);

  const ixsSize = tx.instructions.reduce((acc, ix) => {
    ix.keys.forEach(({ pubkey, isSigner }) => {
      const pk = pubkey.toBase58();
      if (isSigner) signers.add(pk);
      accounts.add(pk);
    });

    accounts.add(ix.programId.toBase58());

    const nIndexes = ix.keys.length;
    const opaqueData = ix.data.length;

    return (
      acc +
      1 + // PID index
      compactArraySize(nIndexes, 1) +
      compactArraySize(opaqueData, 1)
    );
  }, 0);

  return (
    compactArraySize(signers.size, 64) + // signatures
    3 + // header
    compactArraySize(accounts.size, 32) + // accounts
    32 + // blockhash
    compactHeader(tx.instructions.length) + // instructions
    ixsSize
  );
};

// COMPACT ARRAY

const LOW_VALUE = 127; // 0x7f
const HIGH_VALUE = 16383; // 0x3fff

/**
 * Compact u16 array header size
 * @param n elements in the compact array
 * @returns size in bytes of array header
 */
const compactHeader = (n: number) =>
  n <= LOW_VALUE ? 1 : n <= HIGH_VALUE ? 2 : 3;

/**
 * Compact u16 array size
 * @param n elements in the compact array
 * @param size bytes per each element
 * @returns size in bytes of array
 */
const compactArraySize = (n: number, size: number) =>
  compactHeader(n) + n * size;

export const pinFilesToIPFS = async (metadata) => {
  if (!process.env.WEB_STORAGE_TOKEN) {
    console.error(
      "A token is needed. You can create one on https://nft.storage/"
    );
  }

  const nftstorage = new NFTStorage({ token: process.env.WEB_STORAGE_TOKEN });

  const jsonString = JSON.stringify(metadata);
  const blob = new Blob([jsonString], { type: "application/json" });
  const file = new File([blob], `0`, { type: "application/json" });

  const cid = await nftstorage.storeBlob(file);

  return cid;
};

export const sendTx = async (
  ix: TransactionInstruction[],
  payer: Keypair,
  connection: Connection,
  umi: Umi
) => {
  // Get the latest blockhash
  let { blockhash } = await connection.getLatestBlockhash();

  // Create the transaction message
  const message = new TransactionMessage({
    payerKey: payer.publicKey, // Public key of the account that will pay for the transaction
    recentBlockhash: blockhash, // Latest blockhash
    instructions: ix, // Instructions included in transaction
  }).compileToV0Message();

  // Create the versioned transaction using the message
  const transaction = new VersionedTransaction(message);

  // Sign the transaction
  transaction.sign([payer]);

  // Send the signed transaction to the network
  const transactionSignature = await connection.sendTransaction(transaction);

  await validateTxExecution(transactionSignature, umi);
};

export const updateCollectionMetadata = async (
  umi: Umi,
  collectionMint: PublicKey,
  authoritySigner: Signer,
  name?: string,
  uri?: string
) => {
  const initialMetadata = await fetchMetadataFromSeeds(umi, {
    mint: publicKey(collectionMint),
  });

  let newMetadata = {
    ...(name != undefined ? { name } : {}),
    ...(uri != undefined ? { uri } : {}),
  };

  await updateV1(umi, {
    mint: publicKey(collectionMint),
    authority: authoritySigner,
    data: { ...initialMetadata, ...newMetadata },
  }).sendAndConfirm(umi);
};
