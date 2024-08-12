import * as anchor from "@coral-xyz/anchor";
import {
  getPriorityFeeIx,
  loadKeyPair,
  pinFilesToIPFS,
  sendTx,
  validateTxExecution,
} from "../helper";
import {
  AddressLookupTableProgram,
  Connection,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
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
} from "@metaplex-foundation/mpl-token-metadata";

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
  const mintAccount = new anchor.web3.PublicKey(
    process.env.MINT_ACCOUNT_ADDRESS
  );

  // create merkle trees
  const rentalMerkleTree = loadKeyPair(process.env.RENTAL_MERKLE_TREE);

  const landMerkleTree = loadKeyPair(process.env.LAND_MERKLE_TREE);

  const nonceAccount = loadKeyPair(process.env.NONCE_ACCOUNT);

  let feeAccount = new anchor.web3.PublicKey(process.env.FEE_ACCOUNT);

  let rentalCollectionMint = loadKeyPair(process.env.RENTAL_COLLECTION_MINT);

  let landCollectionMint = loadKeyPair(process.env.LAND_COLLECTION_MINT);

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
    await fetchMerkleTree(umi, publicKey(rentalMerkleTree.publicKey));
  } catch (err) {
    if (err.name == AccountNotFoundError.name) {
      await (
        await createTree(umi, {
          merkleTree: createSignerFromKeypair(umi, {
            secretKey: rentalMerkleTree.secretKey,
            publicKey: publicKey(rentalMerkleTree.publicKey),
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

  let landCollectionMintSigner = createSignerFromKeypair(umi, {
    secretKey: landCollectionMint.secretKey,
    publicKey: publicKey(landCollectionMint.publicKey),
  });

  // setup collection
  let rentalCollectionData = await umi.rpc.getAccount(
    rentalCollectionMintSigner.publicKey
  );

  if (!rentalCollectionData.exists) {
    let offChainMetadata = {
      name: "RENTAL Collection",
      symbol: "R-NFT",
      description: "",
      image: "https://docs.sky.trade/logo-square.jpg",
      external_url: "https://sky.trade/",
      attributes: [],
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    await createNft(umi, {
      mint: rentalCollectionMintSigner,
      authority: authoritySigner,
      name: "RENTAL Collection",
      uri: `https://gateway.pinata.cloud/ipfs/${cid}`,
      sellerFeeBasisPoints: percentAmount(0, 2), // 9.99%
      isCollection: true,
      updateAuthority: authoritySigner.publicKey,
    }).sendAndConfirm(umi);
  }

  let landCollectionData = await umi.rpc.getAccount(
    landCollectionMintSigner.publicKey
  );


  if (!landCollectionData.exists) {
    let offChainMetadata = {
      name: "LAND Collection",
      symbol: "L-NFT",
      description: "",
      image: "https://docs.sky.trade/logo-square.jpg",
      external_url: "https://sky.trade/",
      attributes: [],
    };

    let cid = await pinFilesToIPFS(offChainMetadata);

    await createNft(umi, {
      mint: landCollectionMintSigner,
      authority: authoritySigner,
      name: "LAND Collection",
      uri: `https://gateway.pinata.cloud/ipfs/${cid}`,
      sellerFeeBasisPoints: percentAmount(0, 2), // 0.00%
      isCollection: true,
      updateAuthority: authoritySigner.publicKey,
    }).sendAndConfirm(umi);
  }

  try {
    let priorityIx = await getPriorityFeeIx(provider.connection);

    let ix = await program.methods
      .initialize()
      .accounts({
        payer: centralizedAccount.publicKey,
        // centralAuthority: centralAuthority,
        mintAccount: mintAccount,
        // systemProgram: anchor.web3.SystemProgram.programId,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        feeAccount: feeAta.address,
      })
      .instruction();

    await sendTx(
      [priorityIx, ix],
      centralizedAccount,
      provider.connection,
      umi
    );
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

  let lookupTableAddress = new PublicKey(process.env.LOOKUP_TABLE);

  const lookupTableAccount = (
    await connection.getAddressLookupTable(lookupTableAddress)
  ).value;

  // noop must not be in a lookup table
  let addressesToAdd = [
    centralizedAccount.publicKey,
    centralAuthority,
    rentalMerkleTree.publicKey,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID),
    new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID),
    SystemProgram.programId,
  ];

  addressesToAdd = addressesToAdd.filter((el) => {
    const isInLookupTable = lookupTableAccount.state.addresses.some(
      (innerEl) => innerEl.toString() === el.toString()
    );

    return !isInLookupTable;
  });

  if (addressesToAdd.length > 0) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
      payer: centralizedAccount.publicKey,
      authority: centralizedAccount.publicKey,
      lookupTable: lookupTableAddress,
      addresses: addressesToAdd,
    });

    await sendTx(
      [extendInstruction],
      centralizedAccount,
      provider.connection,
      umi
    );
  }

  console.log("successfully initialized ");
})();
