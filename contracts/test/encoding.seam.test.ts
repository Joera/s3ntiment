import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {keccak256, encodeAbiParameters, parseAbiParameters, recoverMessageAddress} from 'viem';
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

// Local hardhat chain id (EDR-simulated default network). Must equal
// block.chainid as seen by the deployed contract, so the off-chain digest
// matches the on-chain oracle.
const CHAIN_ID = BigInt(await provider.request({method: 'eth_chainId'}));

// ---------------------------------------------------------------------------
// SEAM PINNING TEST — shared card encoding (@s3ntiment/shared/invites/encoding).
//
// Proves that the shared `cardMessageHash` / `signCardMessage` used by the
// frontends (invitation.factory, card.factory) and by the contract tests all
// agree on the SAME bytes, and that those bytes satisfy the on-chain oracle
// S3ntimentSurveyStore.registerInPool. CARD-V2 digest (breaking):
//   messageHash   = keccak256(abi.encode(poolId, nullifier, batchId,
//                                       contractAddress, chainId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer        = ecrecover(ethSignedHash, signature) == batchId
//
// This is seam coverage for the previously-independent implementations of the
// card message hash (see brain/audits/seam-coverage-exploration-...md).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reference implementation of the ON-CHAIN digest, recomputed in TS exactly as
// the Solidity oracle does (abi.encode of the five fields in order):
//   messageHash = keccak256(abi.encode(poolId, nullifier, batchId, store, chainId))
// viem's encodeAbiParameters(parseAbiParameters('string,string,address,address,uint256'),
// [...]) reproduces Solidity's field offsets + dynamic-length prefixes.
// ---------------------------------------------------------------------------
function referenceCardMessageHash(
	poolId: string,
	nullifier: string,
	batchId: string,
	storeAddress: string,
	chainId: bigint,
): `0x${string}` {
	return keccak256(
		encodeAbiParameters(
			parseAbiParameters('string,string,address,address,uint256'),
			[poolId, nullifier, batchId, storeAddress, chainId],
		),
	);
}

describe('shared card encoding seam (encoding, card-v2)', function () {
	describe('cardMessageHash', function () {
		it('pins the on-chain abi.encode form (poolId, nullifier, batchId, storeAddress, chainId)', function () {
			const nullifier = 'some-base64url-nullifier';
			const batchId = '0x' + 'ab'.repeat(20);
			const storeAddress = '0x' + 'cd'.repeat(20);
			const context = {poolId: 'pool-1', storeAddress, chainId: 31337n};

			expect(cardMessageHash(context, nullifier, batchId)).toEqual(
				referenceCardMessageHash(
					context.poolId,
					nullifier,
					batchId,
					storeAddress,
					context.chainId,
				),
			);
		});

		it('scopes the digest by pool, contract and chain (varying each changes the hash)', function () {
			const nullifier = 'n';
			const batchId = '0x' + 'ab'.repeat(20);
			const base = {
				poolId: 'pool-1',
				storeAddress: '0x' + 'cd'.repeat(20),
				chainId: 31337n,
			};
			const baseHash = cardMessageHash(base, nullifier, batchId);
			// Each binding dimension changes the digest.
			expect(cardMessageHash({...base, poolId: 'pool-2'}, nullifier, batchId)).not.toEqual(baseHash);
			expect(cardMessageHash({...base, storeAddress: '0x' + 'ef'.repeat(20)}, nullifier, batchId)).not.toEqual(baseHash);
			expect(cardMessageHash({...base, chainId: 8453n}, nullifier, batchId)).not.toEqual(baseHash);
		});

		it('produces a stable deterministic digest (regression canary)', function () {
			// Fixed inputs -> fixed keccak digest (card-v2 abi.encode binding).
			const nullifier = ('A' + 'a'.repeat(21)) as string;
			const batchId = ('0x' + '11'.repeat(20)) as `0x${string}`;
			const storeAddress = ('0x' + 'ee'.repeat(20)) as `0x${string}`;
			const context = {poolId: 'seam-pool-id', storeAddress, chainId: 8453n};
			const hash = cardMessageHash(context, nullifier, batchId);
			expect(hash).toMatchRegex(/^0x[0-9a-f]{64}$/);
			expect(hash).toEqual('0xa01a0fb692be39ccb75d3f44b6e7cb45558cbda2717631ab6e0dafbc77d166d7');
		});
	});

	describe('ethSignedMessageHash', function () {
		it('wraps the raw digest with the EIP-191 personal-sign prefix', function () {
			const context = {
				poolId: 'pool-eth',
				storeAddress: '0x' + 'cc'.repeat(20),
				chainId: 31337n,
			};
			const messageHash = cardMessageHash(context, 'nullifier-x', '0x' + 'cc'.repeat(20));
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
			const context = {
				poolId: 'pool-rt',
				storeAddress: '0x' + 'dd'.repeat(20),
				chainId: 31337n,
			};

			const signature = await signCardMessage(batchWallet, context, nullifier, batchId);

			const recovered = await recoverMessageAddress({
				message: {raw: cardMessageHash(context, nullifier, batchId)},
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

			// The context MUST mirror the on-chain digest: address(this) is the
			// deployed store address and block.chainid is the local chain id.
			const context = {
				poolId,
				storeAddress: S3ntimentSurveyStore.address,
				chainId: CHAIN_ID,
			};
			const signature = await signCardMessage(batchWallet, context, nullifier, batchId);

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
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolId, nullifier, batchId],
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

			const context = {
				poolId,
				storeAddress: S3ntimentSurveyStore.address,
				chainId: CHAIN_ID,
			};
			// Wrong key over the same (pool, nullifier, batchId) — on-chain must reject.
			const badSignature = await signCardMessage(wrongSigner, context, 'seam-card', batchId);
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
