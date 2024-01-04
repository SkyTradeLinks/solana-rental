import { LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import fs from "fs";

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
