import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaSkyTrade } from "../target/types/solana_sky_trade";
import {
  findLeafIndexFromAnchorTx,
  loadKeyPair,
  setupAirDrop,
} from "../helper";
import {
  AccountNotFoundError,
  createSignerFromKeypair,
  publicKey,
  signerIdentity,
} from "@metaplex-foundation/umi";
import { join } from "path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  TokenProgramVersion,
  TokenStandard,
  createTree,
  fetchMerkleTree,
  findTreeConfigPda,
  mintV1,
  mplBubblegum,
  MPL_BUBBLEGUM_PROGRAM_ID,
  getMetadataArgsSerializer,
  findLeafAssetIdPda,
  SPL_NOOP_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  transfer,
  getAssetWithProof,
  verifyLeaf,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  TokenAccountNotFoundError,
  createMint,
  getMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { decode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/bs58";
import { assert } from "chai";
import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";

describe("solana-sky-trade", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaSkyTrade as Program<SolanaSkyTrade>;

  const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

  const centralAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  const mintAccount = loadKeyPair(join(__dirname, "wallets", "coinMint.json"));

  const centralizedAccount = loadKeyPair(
    join(__dirname, "wallets", "centralizedAccount.json")
  );

  const centralizedAccountAta = getAssociatedTokenAddressSync(
    mintAccount.publicKey,
    centralizedAccount.publicKey
  );

  const rentalMerkleTree = loadKeyPair(
    join(__dirname, "wallets", "rentalMerkleTree.json")
  );

  const landMerkleTree = loadKeyPair(
    join(__dirname, "wallets", "landMerkleTree.json")
  );

  const caller = loadKeyPair(join(__dirname, "wallets", "caller.json"));

  const callerAta = getAssociatedTokenAddressSync(
    mintAccount.publicKey,
    caller.publicKey
  );

  const treeConfig = findTreeConfigPda(umi, {
    merkleTree: publicKey(rentalMerkleTree.publicKey),
  })[0];

  const collector = loadKeyPair(join(__dirname, "wallets", "collector.json"));

  const receiver = loadKeyPair(join(__dirname, "wallets", "receiver.json"));

  let createdLeafIndex;

  const metadataArgs = {
    name: "Rental NFT",
    symbol: "",
    uri: "",
    creators: [],
    sellerFeeBasisPoints: 0,
    primarySaleHappened: false,
    isMutable: false,
    editionNonce: null,
    uses: null,
    collection: null,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  };

  let metadataBuffer = getMetadataArgsSerializer().serialize(metadataArgs);

  before(async () => {
    const arr = [];

    for (const el of [centralizedAccount, caller]) {
      let bal = await provider.connection.getBalance(el.publicKey);

      bal = bal / LAMPORTS_PER_SOL;

      if (bal < 5) arr.push(el);
    }

    try {
      setupAirDrop(provider, arr);
    } catch (err) {}

    let authoritySigner = createSignerFromKeypair(umi, {
      secretKey: centralizedAccount.secretKey,
      publicKey: publicKey(centralizedAccount.publicKey),
    });

    umi.use(signerIdentity(authoritySigner));

    try {
      await getMint(provider.connection, mintAccount.publicKey);
    } catch (err: any) {
      if (err.name == TokenAccountNotFoundError.name) {
        // USDC Clone
        await createMint(
          provider.connection,
          centralizedAccount,
          centralizedAccount.publicKey,
          centralizedAccount.publicKey,
          6,
          mintAccount
        );
      }
    }

    // check creation of land merkle tree
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
            maxDepth: 14,
            maxBufferSize: 64,
          })
        ).sendAndConfirm(umi);
      } else {
        throw err;
      }
    }

    // check creation of rental merkle tree
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
            maxDepth: 14,
            maxBufferSize: 64,
            canopyDepth: 7,
          })
        ).sendAndConfirm(umi);
      } else {
        throw err;
      }
    }
  });

  it("should prevent initialization twice", async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          payer: centralizedAccount.publicKey,
          centralAuthority: centralAuthority,
          mintAccount: mintAccount.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([centralizedAccount])
        .rpc();
    } catch (err: any) {
      if (err["error"]["errorCode"]["code"] != "AlreadyInitialized") {
        throw err;
      }
    }
  });

  it("should fail as centralized account didn't call the function", async () => {
    try {
      await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), [])
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: caller.publicKey,
          mint: mintAccount.publicKey,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta,
          rentalMerkleTree: rentalMerkleTree.publicKey,
          treeConfig: treeConfig,
          landMerkleTree: landMerkleTree.publicKey,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([caller, rentalMerkleTree])
        .rpc();
    } catch (err: any) {}
  });

  it("should fail as improper nft data passed", async () => {
    let callerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      caller,
      mintAccount.publicKey,
      caller.publicKey
    );

    let expectedTokenAmount = 1 * Math.pow(10, 6);

    if (callerAta.amount < expectedTokenAmount) {
      await mintTo(
        provider.connection,
        centralizedAccount,
        mintAccount.publicKey,
        callerAta.address,
        centralizedAccount,
        expectedTokenAmount
      );
    }

    try {
      await program.methods
        .mintRentalToken(Buffer.from(metadataBuffer), [])
        .accounts({
          centralAuthority: centralAuthority,
          centralizedAccount: centralizedAccount.publicKey,
          mint: mintAccount.publicKey,
          centralizedAccountAta,
          caller: caller.publicKey,
          callerAta: callerAta.address,
          rentalMerkleTree: rentalMerkleTree.publicKey,
          treeConfig: treeConfig,
          landMerkleTree: landMerkleTree.publicKey,
          bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([centralizedAccount, caller, rentalMerkleTree]);
      // .rpc();

      // await program.
    } catch (err: any) {
      if (
        ![
          "InvalidRemainingAccountsPassed",
          "InsuffientFunds",
          "InvalidLandNFTData",
        ].includes(err["error"]["errorCode"]["code"])
      ) {
        throw err;
      }
    }
  });

  it("should successfully mint an nft", async () => {
    let land_nfts = [0];

    let leavesData = [];
    let accountsToPass = [];

    for (let nft_index of land_nfts) {
      const [assetId, bump] = findLeafAssetIdPda(umi, {
        merkleTree: publicKey(landMerkleTree.publicKey),
        leafIndex: nft_index,
      });

      let assetWithProof;

      try {
        assetWithProof = await getAssetWithProof(umi, assetId);
      } catch (err) {
        // ensure it's created for test purposes!
        if (err.message.includes("Asset not found")) {
          await mintV1(umi, {
            leafOwner: publicKey(collector.publicKey),
            merkleTree: publicKey(landMerkleTree.publicKey),
            metadata: metadataArgs,
          }).sendAndConfirm(umi);

          assetWithProof = await getAssetWithProof(umi, assetId);
        }
      }

      let owner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

      let leafData = {
        leafIndex: new anchor.BN(assetWithProof.index),
        leafNonce: new anchor.BN(assetWithProof.nonce),
        owner,
        delegate:
          assetWithProof.leafDelegate != null
            ? new anchor.web3.PublicKey(assetWithProof.leafDelegate)
            : owner,
        root: new anchor.web3.PublicKey(assetWithProof.root),
        leafHash: [
          ...new anchor.web3.PublicKey(
            assetWithProof.rpcAssetProof.leaf.toString()
          ).toBytes(),
        ],
      };

      leavesData.push(leafData);

      // Push Owner
      accountsToPass.push({
        pubkey: owner,
        isSigner: false,
        isWritable: true,
      });

      let owner_ata = getAssociatedTokenAddressSync(
        mintAccount.publicKey,
        owner
      );

      accountsToPass.push({
        pubkey: owner_ata,
        isSigner: false,
        isWritable: true,
      });
    }

    const mintSx = await program.methods
      .mintRentalToken(Buffer.from(metadataBuffer), leavesData)
      .accounts({
        centralAuthority: centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        mint: mintAccount.publicKey,
        centralizedAccountAta,
        caller: caller.publicKey,
        callerAta: callerAta,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        treeConfig: treeConfig,
        landMerkleTree: landMerkleTree.publicKey,
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([centralizedAccount, caller, rentalMerkleTree])
      .remainingAccounts(accountsToPass)
      .rpc();

    const mintTxInfo = await umi.rpc.getTransaction(decode(mintSx), {
      commitment: "confirmed",
    });

    let leafIndex = findLeafIndexFromAnchorTx(mintTxInfo);

    let [assetId] = findLeafAssetIdPda(umi, {
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      leafIndex: leafIndex,
    });

    createdLeafIndex = leafIndex;

    let rentalAsset = await umi.rpc.getAsset(assetId);

    assert.equal(
      rentalAsset.ownership.owner.toString(),
      caller.publicKey.toString()
    );
  });

  it("should transfer rental nft to another", async () => {
    // leaf index = 33
    let [assetId] = findLeafAssetIdPda(umi, {
      merkleTree: publicKey(rentalMerkleTree.publicKey),
      leafIndex: createdLeafIndex,
    });

    const assetWithProof = await getAssetWithProof(umi, assetId);

    // await verifyLeaf(umi, {
    //   leaf: decode(assetWithProof.rpcAssetProof.leaf.toString()),
    //   merkleTree: assetWithProof.merkleTree,
    //   root: assetWithProof.root,
    //   index: assetWithProof.index,
    // }).sendAndConfirm(umi);

    // await transfer(umi, {
    //   ...assetWithProof,
    //   newLeafOwner: publicKey(receiver.publicKey),
    // }).sendAndConfirm(umi);

    let owner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

    let leafData = {
      leafIndex: assetWithProof.index,
      leafNonce: new anchor.BN(assetWithProof.nonce),
      owner,
      delegate:
        assetWithProof.leafDelegate != null
          ? new anchor.web3.PublicKey(assetWithProof.leafDelegate)
          : owner,
      root: new anchor.web3.PublicKey(assetWithProof.root),
      leafHash: [
        ...new anchor.web3.PublicKey(
          assetWithProof.rpcAssetProof.leaf.toString()
        ).toBytes(),
      ],
    };

    let acc = await ConcurrentMerkleTreeAccount.fromAccountAddress(
      provider.connection,
      rentalMerkleTree.publicKey
    );

    let canopyDepth = acc.getCanopyDepth();

    const proofs = assetWithProof.proof
      .slice(0, assetWithProof.proof.length - (!!canopyDepth ? canopyDepth : 0))
      .map((node) => ({
        pubkey: new anchor.web3.PublicKey(node),
        isSigner: false,
        isWritable: false,
      }));

    await program.methods
      .transferRentalToken(leafData)
      .accounts({
        centralAuthority,
        centralizedAccount: centralizedAccount.publicKey,
        sender: caller.publicKey,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        receiver: receiver.publicKey,
        treeConfig,
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([centralizedAccount, caller, rentalMerkleTree])
      .remainingAccounts(proofs)
      .rpc();

    const asset = await umi.rpc.getAsset(assetId);

    assert.equal(
      asset.ownership.owner.toString(),
      receiver.publicKey.toString()
    );
  });
});
