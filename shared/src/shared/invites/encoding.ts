// Shared card-digest + EIP-191 encoding.
//
// This is the SINGLE source of truth for how a card's "message hash" is
// computed and signed, so the contract tests AND both frontends import the
// SAME bytes. See the seam-coverage audit:
//   brain/audits/seam-coverage-exploration-2026-08-28.md
//
// This module MUST stay LEAF-LEVEL: it imports only `viem` and must not pull
// in Lit / Nillion / d3 (or any other heavy dep), so it can be imported both
// by the Hardhat node-test-runner (contracts) and by the Vite frontends.
//
// CARD-V2 (breaking) digest — the card message is now bound to pool, contract
// and chain, scoping each card to one pool on one contract on one chain:
//   messageHash = keccak256(abi.encode(poolId, nullifier, batchId,
//                                     contractAddress, chainId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer = ecrecover(ethSignedHash, signature) — must equal batchId
// signCardMessage below produces exactly that ethSignedHash signature.
//
// The on-chain oracle (S3ntimentSurveyStore.sol, registerInPool) computes the
// identical digest with (poolId, nullifier, batchId, address(this),
// block.chainid). abi.encode (NOT encodePacked) is mandatory: poolId and
// nullifier are both dynamic strings, so packed concatenation would not be
// collision-safe. The equivalent viem encoding is `abi.encode` ==
// encodeAbiParameters(['string','string','address','address','uint256'], [...]),
// which reproduces Solidity's field offsets + dynamic-length prefixes exactly.

import {
	concat,
	encodeAbiParameters,
	keccak256,
	parseAbiParameters,
	stringToBytes,
	toBytes,
} from 'viem';
import type {LocalAccount} from 'viem/accounts';

/**
 * The static per-deployment binding of a card to pool, contract and chain.
 * `storeAddress` must be the address of S3ntimentSurveyStore on which the card
 * will be redeemed; `chainId` must be that deployment's chain id (the contract
 * uses address(this) and block.chainid). `poolId` scopes the card to a pool.
 */
export interface CardMessageContext {
	poolId: string;
	storeAddress: string;
	chainId: bigint;
}

/**
 * The raw card message hash:
 *   keccak256(abi.encode(poolId, nullifier, batchId, storeAddress, chainId))
 *
 * This is byte-identical to the on-chain digest built by
 * S3ntimentSurveyStore.registerInPool with address(this) == storeAddress and
 * block.chainid == chainId. The equivalence is pinned by
 * contracts/test/encoding.seam.test.ts.
 */
export function cardMessageHash(
	context: CardMessageContext,
	nullifier: string,
	batchId: string,
): `0x${string}` {
	return keccak256(
		encodeAbiParameters(
		parseAbiParameters('string,string,address,address,uint256'),
		[
			context.poolId,
			nullifier,
			batchId as `0x${string}`,
			context.storeAddress as `0x${string}`,
			context.chainId,
		],
		),
	);
}

/**
 * The EIP-191 personal-sign digest wrapped over a 32-byte message hash:
 * keccak256("\x19Ethereum Signed Message:\n32" ++ messageHash).
 */
export function ethSignedMessageHash(messageHash: `0x${string}`): `0x${string}` {
	return keccak256(
		concat([
			stringToBytes('\x19Ethereum Signed Message:\n32'),
			toBytes(messageHash),
		]),
	);
}

/**
 * Sign a card message with `account` (a viem LocalAccount, e.g. from
 * privateKeyToAccount) so it satisfies on-chain registerInPool:
 *   - recovered signer == batchId
 *   - recoverable to batchId via
 *       recoverMessageAddress({ message: { raw: cardMessageHash(...) }, signature })
 */
export async function signCardMessage(
	account: LocalAccount<string>,
	context: CardMessageContext,
	nullifier: string,
	batchId: string,
): Promise<`0x${string}`> {
	const messageHash = cardMessageHash(context, nullifier, batchId);
	const ethSignedHash = ethSignedMessageHash(messageHash);
	// `sign` is typed optional on LocalAccount but is always present on the
	// viem accounts passed here (privateKeyToAccount / createBatchWallet).
	return account.sign!({hash: ethSignedHash});
}
