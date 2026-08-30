// rotate-member.signing.ts
//
// Client-side production of the `rotateMember(poolId, newLeaf, signature)` digest
// + EIP-191 personal-sign signature. This mirrors EXACTLY the idiom the contract
// PR #24 (deepseek/rotate-member / commit eaf1a287f) uses in its own test:
//
//   digest        = keccak256(abi.encode(poolId, oldLeaf, newLeaf,
//                                        address(this), block.chainid))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + digest)
//   signature     = ECDSA(ethSignedHash) by the CURRENT member leaf's key
//
// and S3ntimentSurveyStore.rotateMember recovers that signature and requires the
// recovered signer == ISMC(msg.sender).owner() (the acting leaf) AND that the old
// leaf is currently a member. The `abi.encode` (== encodeAbiParameters with the
// padded (string,address,address,address,uint256) tuple) is REQUIRED so the client
// digest matches the on-chain digest bound to poolId + newLeaf + this store + chain.
//
// We sign the raw ethSignedHash via the smart-account owner's viem key account
// (`getSigner().sign({ hash })`), exactly like the contract test, rather than the
// string `signMessage` convenience (which would EIP-191-wrap a UTF-8 string, not
// the raw 32-byte digest).

import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  concat,
  stringToBytes,
  toBytes,
} from 'viem';

/** The rotateMember ABI fragment (functionName `rotateMember`). */
export const ROTATE_MEMBER_ABI = [
  {
    type: 'function',
    name: 'rotateMember',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'string', name: 'poolId' },
      { type: 'address', name: 'newLeaf' },
      { type: 'bytes', name: 'signature' },
    ],
    outputs: [],
  },
] as const;

/** The affected store's contract address + chain id used to bind the digest. */
export interface RotationContext {
  storeAddress: `0x${string}`;
  chainId: bigint;
}

/**
 * Compute the EIP-191 personal-sign signature an OLD acting leaf (current member)
 * must produce to authorize rotating its membership onto `newLeaf`.
 *
 * @param signer    The viem key account of the CURRENT member leaf (E / bootstrap).
 * @param poolId    Pool the member belongs to.
 * @param oldLeaf   The current member leaf address (the SMC owner).
 * @param newLeaf   The derived leaf S the membership rotates onto.
 * @param ctx       Store address + chain id to bind the digest (replay safety).
 */
export async function signRotateMessage(
  signer: { sign: (args: { hash: `0x${string}` }) => Promise<`0x${string}`> | `0x${string}` },
  poolId: string,
  oldLeaf: `0x${string}`,
  newLeaf: `0x${string}`,
  ctx: RotationContext,
): Promise<`0x${string}`> {
  const digest = keccak256(
    encodeAbiParameters(
      parseAbiParameters('string,address,address,address,uint256'),
      [poolId, oldLeaf, newLeaf, ctx.storeAddress, ctx.chainId],
    ),
  );
  const ethSignedHash = keccak256(
    concat([stringToBytes('\x19Ethereum Signed Message:\n32'), toBytes(digest)]),
  );
  return await signer.sign({ hash: ethSignedHash });
}
