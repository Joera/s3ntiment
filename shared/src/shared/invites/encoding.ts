// Shared card-digest + EIP-191 encoding.
//
// This is the SINGLE source of truth for how a card's "message hash" is
// computed and signed, so the contract tests AND both frontends import the
// SAME bytes. See the seam-coverage audit:
//   brain/audits/seam-coverage-exploration-2026-08-28.md
// (four independent implementations of the card message hash previously
// lived in S3ntimentSurveyStore.sol, the contract test, invitation.factory
// and card.factory — this module is the seam that unifies them).
//
// This module MUST stay LEAF-LEVEL: it imports only `viem` and must not pull
// in Lit / Nillion / d3 (or any other heavy dep), so it can be imported both
// by the Hardhat node-test-runner (contracts) and by the Vite frontends.
//
// The on-chain oracle (S3ntimentSurveyStore.sol, registerInPool) is:
//   messageHash = keccak256(abi.encodePacked(nullifier, "|", batchId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer = ecrecover(ethSignedHash, signature)  — must equal batchId
// signCardMessage below produces exactly that ethSignedHash signature.

import {
	concat,
	encodePacked,
	keccak256,
	stringToBytes,
	toBytes,
} from 'viem';
import type {LocalAccount} from 'viem/accounts';

/**
 * The raw card message hash: keccak256(abi.encodePacked(nullifier, "|", batchId)).
 *
 * NOTE — legacy byte-concat form: this must stay byte-identical to the old
 * hand-rolled `encodeNullifierBatchCombo` in card.factory.ts (UTF-8 nullifier
 * ++ "|" ++ raw 20-byte batchId). That equivalence is pinned by
 * contracts/test/encoding.seam.test.ts.
 */
export function cardMessageHash(
	nullifier: string,
	batchId: string,
): `0x${string}` {
	return keccak256(
		encodePacked(
			['string', 'string', 'address'] as const,
			[nullifier, '|', batchId as `0x${string}`],
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
	nullifier: string,
	batchId: string,
): Promise<`0x${string}`> {
	const messageHash = cardMessageHash(nullifier, batchId);
	const ethSignedHash = ethSignedMessageHash(messageHash);
	// `sign` is typed optional on LocalAccount but is always present on the
	// viem accounts passed here (privateKeyToAccount / createBatchWallet).
	return account.sign!({hash: ethSignedHash});
}
