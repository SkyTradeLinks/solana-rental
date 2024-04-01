import * as anchor from "@coral-xyz/anchor";
import {
  getPriorityFeeIx,
  loadKeyPair,
  loadKeyPairV2,
  validateTxExecution,
} from "../helper";
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
  mintToCollectionV1,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  AccountNotFoundError,
  createSignerFromKeypair,
  percentAmount,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import "dotenv/config";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import {
  createNft,
  mplTokenMetadata,
  findCollectionAuthorityRecordPda,
  findMetadataPda,
  findEditionMarkerV2Pda,
  findMasterEditionPda,
  verifyCollectionV1,
} from "@metaplex-foundation/mpl-token-metadata";
import { join } from "path";

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

  // findCollectionAuthorityRecordPda(umi, {})

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

  let rentalCollectionMint = loadKeyPair(process.env.RENTAL_COLLECTION_MINT);

  // needs to have ata address (USDC) before assigning as fee Account
  let feeAta = await getOrCreateAssociatedTokenAccount(
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

  let rentalCollectionMintSigner = createSignerFromKeypair(umi, {
    secretKey: rentalCollectionMint.secretKey,
    publicKey: publicKey(rentalCollectionMint.publicKey),
  });

  // setup collection

  let rentalCollectionData = await umi.rpc.getAccount(
    rentalCollectionMintSigner.publicKey
  );

  if (!rentalCollectionData.exists) {
    await createNft(umi, {
      mint: rentalCollectionMintSigner,
      // authority: authoritySigner,
      name: "My Collection NFT",
      uri: "https://example.com/path/to/some/json/metadata.json",
      sellerFeeBasisPoints: percentAmount(0, 2), // 9.99%
      isCollection: true,
      updateAuthority: authoritySigner.publicKey,
    }).sendAndConfirm(umi);
  }

  // try {
  //   let priorityIx = await getPriorityFeeIx(provider.connection);

  //   let ix = await program.methods
  //     .initialize()
  //     .accounts({
  //       payer: centralizedAccount.publicKey,
  //       centralAuthority: centralAuthority,
  //       mintAccount: mintAccount,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //       rentalMerkleTree: rentalMerkleTree.publicKey,
  //       feeAccount: feeAta.address,
  //     })
  //     .instruction();

  //   let tx = new anchor.web3.Transaction();

  //   tx.add(priorityIx);
  //   tx.add(ix);

  //   tx.recentBlockhash = await (
  //     await provider.connection.getLatestBlockhash()
  //   ).blockhash;

  //   tx.feePayer = centralizedAccount.publicKey;
  //   tx.sign(centralizedAccount);

  //   let sx = await provider.connection.sendRawTransaction(tx.serialize());

  //   await validateTxExecution(sx, umi);
  // } catch (err) {
  //   console.log(err);
  // }

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

  const caller = loadKeyPair(
    join(__dirname, "..", "tests/wallets/caller.json")
  );

  // test mint?

  let ix = await mintToCollectionV1(umi, {
    leafOwner: publicKey(caller.publicKey),
    merkleTree: publicKey(rentalMerkleTree.publicKey),
    collectionMint: publicKey(rentalCollectionMint.publicKey),
    collectionAuthority: authoritySigner,
    metadata: {
      name: "My Compressed NFT",
      uri: "https://example.com/my-cnft.json",
      sellerFeeBasisPoints: 500, // 5%
      collection: {
        key: publicKey(rentalCollectionMint.publicKey),
        verified: true,
      },
      creators: [
        { address: umi.identity.publicKey, verified: false, share: 100 },
      ],
    },
  }).buildWithLatestBlockhash(umi);

  console.log(authoritySigner.publicKey);

  console.log(rentalCollectionMint.publicKey);

  // console.log(ix.message.accounts);
  // ix.message.accounts

  let [collectionMetadata] = findMetadataPda(umi, {
    mint: publicKey(rentalCollectionMint.publicKey),
  });

  console.log(collectionMetadata);

  let [collectionEdition] = findMasterEditionPda(umi, {
    mint: publicKey(rentalCollectionMint.publicKey),
  });

  console.log(collectionEdition);

  // await verifyCollectionV1(umi, {
  //   metadata: collectionMetadata,
  //   collectionMint: publicKey(rentalCollectionMint.publicKey),
  //   authority: authoritySigner,
  // }).sendAndConfirm(umi);
})();
