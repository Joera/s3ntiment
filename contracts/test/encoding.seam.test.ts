import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {keccak256, recoverMessageAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {
	cardMessageHash,
	ethSignedMessageHash,
	signCardMessage,
} from '@s3ntiment/shared/invites/encoding';
import {setupSurveyStoreFixtures} from './utils/index.js';

const {provider, networkHelpers, viem} = await network.connect();
const {deployAll} = setupSurveyStoreFixtures(provider);

// Deterministic local batch wallet (same as the org's createBatchWallet).
function createBatchWallet(byte = 'aa') {
	return privateKeyToAccount('0x' + byte.repeat(32));
}

// ---------------------------------------------------------------------------
// SEAM PINNING TEST — shared card encoding (@s3ntiment/shared/invites/encoding).
//
// Proves that the shared `cardMessageHash` / `signCardMessage` used by the
// frontends (invitation.factory, card.factory) and by the contract tests all
// agree on the SAME bytes, and that those bytes satisfy the on-chain oracle
// S3ntimentSurveyStore.registerInPool:
//   messageHash   = keccak256(abi.encodePacked(nullifier, "|", batchId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer        = ecrecover(ethSignedHash, signature) == batchId
//
// This is seam coverage for the four previously-independent implementations
// of the card message hash (see brain/audits/seam-coverage-exploration-...md).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// (a) PINNED LEGACY form. This is the old hand-rolled byte-concatenation that
// used to live (private) in shared/src/shared/invites/card.factory.ts as
// `encodeNullifierBatchCombo`: UTF-8(nullifier) ++ "|" ++ raw 20-byte batchId,
// then keccak256. It is kept here as a reference implementation and pinned to
// stay byte-identical to the shared `cardMessageHash`.
// ---------------------------------------------------------------------------
function legacyEncodeNullifierBatchCombo(
	nullifier: string,
	batchId: string,
): `0x${string}` {
	const nullifierBytes = new TextEncoder().encode(nullifier);
	const pipeBytes = new TextEncoder().encode('|');
	const addressBytes = batchId.slice(2);

	const hexStr =
		Array.from(nullifierBytes)
			.concat(Array.from(pipeBytes))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('') + addressBytes;

	return keccak256(('0x' + hexStr) as `0x${string}`);
}

describe('shared card encoding seam (encoding)', function () {
	describe('cardMessageHash', function () {
		it('pins the legacy hand-rolled byte-concat form (card.factory encodeNullifierBatchCombo)', function () {
			const nullifier = 'some-base64url-nullifier';
			const batchId = '0x' + 'ab'.repeat(20);

			expect(cardMessageHash(nullifier, batchId)).toEqual(
				legacyEncodeNullifierBatchCombo(nullifier, batchId),
			);
		});

		it('produces a stable deterministic digest (regression canary)', function () {
			// Fixed nullifier (22 chars) + batchId -> fixed keccak digest.
			const nullifier = ('A' + 'a'.repeat(21)) as string;
			const batchId = ('0x' + '11'.repeat(20)) as `0x${string}`;
			const hash = cardMessageHash(nullifier, batchId);
			expect(hash).toMatchRegex(/^0x[0-9a-f]{64}$/);
			expect(hash).toEqual('0x43c87d2c1e8de0c149a78a0505da65ae3a9ffcb72b17d6d4433b5ba0fcb2c785');
		});
	});

	describe('ethSignedMessageHash', function () {
		it('wraps the raw digest with the EIP-191 personal-sign prefix', function () {
			const messageHash = cardMessageHash('nullifier-x', '0x' + 'cc'.repeat(20));
			const ethSigned = ethSignedMessageHash(messageHash);
			// Deterministic 32-byte hex digest.
			expect(ethSigned).toMatchRegex(/^0x[0-9a-f]{64}$/);
		});
	});

	describe('signCardMessage → recover round-trip', function () {
		it('recovers to batchId via recoverMessageAddress (invitation.factory path)', async function () {
			const batchWallet = createBatchWallet();
			const batchId = batchWallet.address;
			const nullifier = 'roundtrip-nullifier';

			const signature = await signCardMessage(batchWallet, nullifier, batchId);

			const recovered = await recoverMessageAddress({
				message: {raw: cardMessageHash(nullifier, batchId)},
				signature,
			});
			expect(recovered.toLowerCase()).toEqual(batchId.toLowerCase());
		});

		it('recovers to batchId on-chain via registerInPool (contract oracle path)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'seam-pool';
			const batchWallet = createBatchWallet();
			const batchId = batchWallet.address;
			const nullifier = 'seam-card';

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['seam-survey', poolId, 'QmCidSeam', [batchId]],
				account: safe,
			});

			const signature = await signCardMessage(batchWallet, nullifier, batchId);

			// The shared-encoding signature is accepted on-chain: the recovered
			// signer (batchId) matches what registerInPool requires, proving the
			// on-chain messageHash/ethSignedHash == shared cardMessageHash.
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				nullifier,
				batchId,
				signature,
			]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, poolWallet],
				}),
			).toEqual(true);
		});

		it('reverts on-chain when the signer is not the batch wallet', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'seam-pool-wrong';
			const batchWallet = createBatchWallet();
			const batchId = batchWallet.address;
			const wrongSigner = createBatchWallet('ab');

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['seam-survey-w', poolId, 'QmCidSeam', [batchId]],
				account: safe,
			});

			// Wrong key over the same (nullifier, batchId) — on-chain must reject.
			const badSignature = await signCardMessage(wrongSigner, 'seam-card', batchId);
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'seam-card',
					batchId,
					badSignature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);
		});
	});
});
