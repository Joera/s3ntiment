import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {keccak256, encodePacked, concat, stringToBytes, toBytes} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {setupSurveyStoreFixtures} from './utils/index.js';

const {provider, networkHelpers, viem} = await network.connect();
const {deployAll} = setupSurveyStoreFixtures(provider);

// ---------------------------------------------------------------------------
// Card / SMC helpers.
//
// registerInPool validates a card before joining:
//   messageHash = keccak256(abi.encodePacked(nullifier, "|", batchId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer = ecrecover(ethSignedHash, signature)  — must equal batchId
// The caller must be an SMC whose owner() is the respondent's pool-wallet EOA.
//
// We use a locally-owned batch wallet (privateKeyToAccount) and sign the exact
// 32-byte ethSignedHash digest so the recovered signer is deterministic.
// ---------------------------------------------------------------------------

function cardMessageHash(nullifier: string, batchId: string): `0x${string}` {
	return keccak256(
		encodePacked(['string', 'string', 'address'], [nullifier, '|', batchId]),
	);
}

function createBatchWallet(byte = 'aa') {
	// Fixed 32-byte private key → deterministic batch-wallet address.
	return privateKeyToAccount('0x' + byte.repeat(32));
}

async function signCard(
	batch: ReturnType<typeof createBatchWallet>,
	nullifier: string,
	batchAddress: string,
) {
	const messageHash = cardMessageHash(nullifier, batchAddress);
	const ethSignedHash = keccak256(
		concat([
			stringToBytes('\x19Ethereum Signed Message:\n32'),
			toBytes(messageHash),
		]),
	);
	return batch.sign({hash: ethSignedHash});
}

describe('S3ntimentSurveyStore', function () {
	describe('pool + survey lifecycle (createSurvey)', function () {
		it('bootstraps a new pool and returns pool + survey data', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-1';
			const surveyId = 'survey-1';
			const ipfsCid = 'QmCid1';
			const batchA = '0x' + '11'.repeat(20);
			const batchB = '0x' + '22'.repeat(20);

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: [surveyId, poolId, ipfsCid, [batchA, batchB]],
				account: safe,
			});

			// Survey
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'surveyExists',
					args: [surveyId],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'surveyExists',
					args: ['unknown-survey'],
				}),
			).toEqual(false);
			const survey = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSurvey',
				args: [surveyId],
			});
			expect(survey[0]).toEqual(ipfsCid);
			expect(survey[1]).toEqual(poolId);
			expect(survey[2]).toBeGreaterThan(0n);

			// Pool (created implicitly, msg.sender becomes the Safe)
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'poolExists',
					args: [poolId],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'poolExists',
					args: ['unknown-pool'],
				}),
			).toEqual(false);

			const pool = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPool',
				args: [poolId],
			});
			expect(pool[0].toLowerCase()).toEqual(safe.toLowerCase());
			expect(pool[1]).toBeGreaterThan(0n);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolSafe',
					args: [safe, poolId],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolSafe',
					args: [unnamedAccounts[1], poolId],
				}),
			).toEqual(false);

			// safe -> poolIds and pool -> surveyIds
			const safePools = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSafePools',
				args: [safe],
			});
			expect(safePools).toEqual([poolId]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveys',
					args: [poolId],
				}),
			).toEqual([surveyId]);

			// Batches registered during pool bootstrap
			const poolBatches = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolBatches',
				args: [poolId],
			});
			// Batches are recorded in the order they were passed.
			expect(poolBatches.map((b) => b.toLowerCase())).toEqual([
				batchA.toLowerCase(),
				batchB.toLowerCase(),
			]);
		});

		it('lets the pool Safe add further surveys to an existing pool', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-multi';

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s2', poolId, 'QmCid2', []],
				account: safe,
			});

			const surveys = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveys',
				args: [poolId],
			});
			expect(surveys).toEqual(['s1', 's2']);
		});

		it('reverts when surveyId, poolId or ipfsCid is empty', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const account = unnamedAccounts[0];

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['', 'pool', 'cid', []],
					account,
				}),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'Survey ID cannot be empty'`,
			);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s', '', 'cid', []],
					account,
				}),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'Pool ID cannot be empty'`,
			);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s', 'pool', '', []],
					account,
				}),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'IPFS CID cannot be empty'`,
			);
		});

		it('reverts when creating a duplicate surveyId (SurveyAlreadyExists)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['dup', 'pool-dup', 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['dup', 'pool-other', 'QmCid2', []],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'SurveyAlreadyExists()'`);
		});

		it('reverts when a non-safe adds a survey to an existing pool (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', 'pool-auth', 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s2', 'pool-auth', 'QmCid2', []],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('ignores batchIds when adding a survey to an existing pool', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-ignore-batch';
			const batch = '0x' + '33'.repeat(20);

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});
			// A batch passed to a later createSurvey on an existing pool is ignored.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s2', poolId, 'QmCid2', [batch]],
				account: safe,
			});

			await expect(
				env.read(S3ntimentSurveyStore, {
					functionName: 'getBatch',
					args: [poolId, batch],
				}),
			).toBeRejectedWith(`custom error 'BatchNotFound()'`);

			const poolBatches = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolBatches',
				args: [poolId],
			});
			expect(poolBatches).toEqual([]);
		});
	});

	describe('updateSurvey', function () {
		it('lets the pool Safe update a survey IPFS CID', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', 'pool-up', 'QmCid1', []],
				account: safe,
			});

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'updateSurvey',
				args: ['s1', 'QmCidUpdated'],
				account: safe,
			});

			const survey = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSurvey',
				args: ['s1'],
			});
			expect(survey[0]).toEqual('QmCidUpdated');
		});

		it('reverts when a non-safe updates a survey (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', 'pool-up-auth', 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'updateSurvey',
					args: ['s1', 'QmCidHacked'],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('reverts when updating a survey that does not exist (SurveyNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'updateSurvey',
					args: ['missing', 'QmCid'],
					account: unnamedAccounts[0],
				}),
			).toBeRejectedWith(`custom error 'SurveyNotFound()'`);
		});
	});

	describe('read-only getters', function () {
		it('reverts getSurvey for an unknown survey (SurveyNotFound)', async function () {
			const {env, S3ntimentSurveyStore} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.read(S3ntimentSurveyStore, {
					functionName: 'getSurvey',
					args: ['nope'],
				}),
			).toBeRejectedWith(`custom error 'SurveyNotFound()'`);
		});

		it('reverts getPool for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.read(S3ntimentSurveyStore, {
					functionName: 'getPool',
					args: ['nope'],
				}),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});

		it('returns empty arrays for unknown safe/pool', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getSafePools',
					args: [unnamedAccounts[9]],
				}),
			).toEqual([]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveys',
					args: ['nope'],
				}),
			).toEqual([]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolBatches',
					args: ['nope'],
				}),
			).toEqual([]);
		});
	});

	describe('batch management (registerBatch)', function () {
		it('lets the pool Safe register a new batch wallet', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-batch';
			const batch = '0x' + '44'.repeat(20);
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'registerBatch',
				args: [poolId, batch],
				account: safe,
			});

			const batchData = await env.read(S3ntimentSurveyStore, {
				functionName: 'getBatch',
				args: [poolId, batch],
			});
			// [createdAt, cardCount]
			expect(batchData[0]).toBeGreaterThan(0n);
			expect(batchData[1]).toEqual(0n);

			const poolBatches = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolBatches',
				args: [poolId],
			});
			expect(poolBatches.map((b) => b.toLowerCase())).toEqual([batch]);
		});

		it('reverts registerBatch for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'registerBatch',
					args: ['ghost-pool', '0x' + '55'.repeat(20)],
					account: unnamedAccounts[0],
				}),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});

		it('reverts registerBatch when called by a non-safe (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			const poolId = 'pool-batch-auth';
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'registerBatch',
					args: [poolId, '0x' + '66'.repeat(20)],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('reverts registerBatch for the zero batch address (InvalidBatchId)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-batch-zero';
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'registerBatch',
					args: [poolId, '0x0000000000000000000000000000000000000000'],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'InvalidBatchId()'`);
		});

		it('reverts registerBatch for an already-registered batch (BatchAlreadyRegistered)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-batch-dup';
			const batch = '0x' + '77'.repeat(20);
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batch]],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'registerBatch',
					args: [poolId, batch],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'BatchAlreadyRegistered()'`);
		});

		it('reverts getBatch for an unregistered batch (BatchNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-batch-read';
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.read(S3ntimentSurveyStore, {
					functionName: 'getBatch',
					args: [poolId, '0x' + '88'.repeat(20)],
				}),
			).toBeRejectedWith(`custom error 'BatchNotFound()'`);
		});
	});

	describe('registration (registerInPool)', function () {
		it('registers an SMC owner as a pool member with a valid card', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const poolId = 'pool-reg';
			const nullifier = 'card-nullifier-1';

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const signature = await signCard(batchWallet, nullifier, batchAddress);
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				nullifier,
				batchAddress,
				signature,
			]);

			// Member recorded
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, poolWallet],
				}),
			).toEqual(true);
			// Non-member is not a member
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, unnamedAccounts[5]],
				}),
			).toEqual(false);
			// Nullifier burned
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [nullifier, batchAddress],
				}),
			).toEqual(true);
			// Batch card count incremented
			const batchData = await env.read(S3ntimentSurveyStore, {
				functionName: 'getBatch',
				args: [poolId, batchAddress],
			});
			expect(batchData[1]).toEqual(1n);
		});

		it('registers multiple distinct members with distinct cards', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-reg-multi';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const members = [unnamedAccounts[3], unnamedAccounts[4]];
			for (let i = 0; i < members.length; i++) {
				const member = members[i];
				const nullifier = `card-${i}`;
				const signature = await signCard(batchWallet, nullifier, batchAddress);
				const mockSmc = await viem.deployContract('MockSMC', [member]);
				await mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					nullifier,
					batchAddress,
					signature,
				]);
			}

			for (const member of members) {
				expect(
					await env.read(S3ntimentSurveyStore, {
						functionName: 'isPoolMember',
						args: [poolId, member],
					}),
				).toEqual(true);
			}
			const batchData = await env.read(S3ntimentSurveyStore, {
				functionName: 'getBatch',
				args: [poolId, batchAddress],
			});
			expect(batchData[1]).toEqual(2n);
		});

		it('keeps membership scoped per pool (no cross-pool correlation)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const otherSafe = unnamedAccounts[1];
			const poolWallet = unnamedAccounts[3];
			const poolA = 'pool-scope-a';
			const poolB = 'pool-scope-b';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a1', poolA, 'QmCidA', [batchAddress]],
				account: safe,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b1', poolB, 'QmCidB', [batchAddress]],
				account: otherSafe,
			});

			const signature = await signCard(batchWallet, 'card-scope', batchAddress);
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolA,
				'card-scope',
				batchAddress,
				signature,
			]);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolA, poolWallet],
				}),
			).toEqual(true);
			// Same wallet is NOT a member of the other pool.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolB, poolWallet],
				}),
			).toEqual(false);
		});

		it('reverts for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const poolWallet = unnamedAccounts[3];
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);

			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					'ghost-pool',
					'card',
					batchAddress,
					'0x',
				]),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});

		it('reverts for an unregistered batch (BatchNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-batch';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card',
					batchAddress,
					'0x',
				]),
			).toBeRejectedWith(`custom error 'BatchNotFound()'`);
		});

		it('reverts when the card signature does not match the batch wallet (InvalidSignature)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-sig';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			// A distinct key — NOT the batch wallet.
			const wrongSigner = createBatchWallet('ab');

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			// Sign with a different wallet than the batch wallet.
			const signature = await signCard(wrongSigner, 'card-sig', batchAddress);

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-sig',
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);
		});

		it('reverts when a card (nullifier) is reused (NullifierAlreadyUsed)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const secondWallet = unnamedAccounts[4];
			const poolId = 'pool-reg-nullifier';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const nullifier = 'card-once';

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const signature = await signCard(batchWallet, nullifier, batchAddress);

			// First use: ok
			const smc1 = await viem.deployContract('MockSMC', [poolWallet]);
			await smc1.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				nullifier,
				batchAddress,
				signature,
			]);

			// Second use of the same card by a different member: revert
			const smc2 = await viem.deployContract('MockSMC', [secondWallet]);
			await expect(
				smc2.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					nullifier,
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'NullifierAlreadyUsed()'`);
		});

		it('reverts when the SMC owner is already a member (AlreadyPoolMember)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-member';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);

			// join once with card-1
			let signature = await signCard(batchWallet, 'card-1', batchAddress);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				'card-1',
				batchAddress,
				signature,
			]);

			// second join with a fresh, valid card still reverts
			signature = await signCard(batchWallet, 'card-2', batchAddress);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-2',
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'AlreadyPoolMember()'`);
		});

		it('rejects a bare EOA caller (msg.sender must be an SMC)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const eoaCaller = unnamedAccounts[3];
			const poolId = 'pool-reg-eoa';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			// A card signed by the batch wallet, but called directly from an EOA
			// (not an SMC) — identity resolution ISMC(msg.sender).owner() cannot
			// run, so registration must revert.
			const signature = await signCard(batchWallet, 'card-eoa', batchAddress);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'registerInPool',
					args: [poolId, 'card-eoa', batchAddress, signature],
					account: eoaCaller,
					gas: 1000000n,
				}),
			).toBeRejectedWith(
				'Transaction reverted: function returned an unexpected amount of data',
			);

			// The EOA was not recorded as a member.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, eoaCaller],
				}),
			).toEqual(false);
		});

		it('rejects a signature of the wrong length', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-len';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			// 64-byte signature (invalid length)
			const shortSignature = '0x' + 'ab'.repeat(64);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-len',
					batchAddress,
					shortSignature,
				]),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'Invalid signature length'`,
			);
		});
	});
});
