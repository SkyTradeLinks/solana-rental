import { getAssetWithProof } from "@metaplex-foundation/mpl-bubblegum";
import { publicKey, Umi } from "@metaplex-foundation/umi";
import { ConcurrentMerkleTreeAccount } from "@solana/spl-account-compression";
import { Connection, PublicKey } from "@solana/web3.js";

export const getAssetDataAndProof = async (
  landAssetId: PublicKey,
  umi: Umi,
  connection: Connection
) => {
  let assetWithProof = await getAssetWithProof(umi, publicKey(landAssetId));

  let landOwner = new anchor.web3.PublicKey(assetWithProof.leafOwner);

  const landAssetLeafData = {
    index: assetWithProof.index,
    nonce: new anchor.BN(assetWithProof.nonce),
    root: Array.from(assetWithProof.root),
    hash: Array.from(assetWithProof.dataHash),
    creatorHash: Array.from(assetWithProof.creatorHash),
  };
  const splCMT = await ConcurrentMerkleTreeAccount.fromAccountAddress(
    connection,
    new PublicKey(assetWithProof.merkleTree)
  );
  const canopyDepth = splCMT.getCanopyDepth();
  const landAssetProof = assetWithProof.proof
    .map((node) => ({
      pubkey: new PublicKey(node),
      isSigner: false,
      isWritable: false,
    }))
    .slice(0, assetWithProof.proof.length - canopyDepth);

  return { landAssetLeafData, landAssetProof, landOwner };
};
