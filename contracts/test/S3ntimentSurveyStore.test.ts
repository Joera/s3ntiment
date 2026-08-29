import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {privateKeyToAccount} from 'viem/accounts';
import {signCardMessage} from '@s3ntiment/shared/invites/encoding';
import {setupSurveyStoreFixtures} from './utils/index.js';

const {provider, networkHelpers, viem} = await network.connect();
const {deployAll} = setupSurveyStoreFixtures(provider);

// ---------------------------------------------------------------------------
// Card / SMC helpers.
//
// registerInPool validates a card before joining:
//   messageHash = keccak256(abi.encode(poolId, nullifier, batchId,
//                                   address(this), block.chainid))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + messageHash)
//   signer = ecrecover(ethSignedHash, signature)  — must equal batchId
// The caller must be an SMC whose owner() is the respondent's pool-wallet EOA.
//
// cardMessageHash / signCardMessage now come from the shared encoding module
// (@s3ntiment/shared/invites/encoding) — the single source of truth shared
// with the frontends (CARD-V2 digest: bound to pool + contract + chain). The
// recovered signer is deterministic because we sign the exact 32-byte
// ethSignedHash digest produced by that module over the deployment binding.
// ---------------------------------------------------------------------------

function createBatchWallet(byte = 'aa') {
	// Fixed 32-byte private key → deterministic batch-wallet address.
	return privateKeyToAccount('0x' + byte.repeat(32));
}

// Local hardhat chain id (EDR-simulated default network) == block.chainid the
// deployed contract sees. Must match the off-chain digest binding so signatures
// produced by the shared encoding are accepted on-chain.
const CHAIN_ID = BigInt(await provider.request({method: 'eth_chainId'}));

// Builds the pool/contract/chain card-binding context from the deployed store.
function cardContext(storeAddress: string, poolId: string) {
	return {poolId, storeAddress, chainId: CHAIN_ID};
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

		it('reverts during createSurvey bootstrap for a zero-address batch (InvalidBatchId)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-bootstrap-zero';
			const zeroBatch = '0x0000000000000000000000000000000000000000';

			// A zero-address batch in the INITIAL batchIds array is routed through
			// _registerBatch by the bootstrap path — the InvalidBatchId branch that is
			// otherwise only exercised via registerBatch. The whole tx reverts.
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s1', poolId, 'QmCid1', [zeroBatch]],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'InvalidBatchId()'`);

			// Also a mixed array: a valid batch first, then a zero address.
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s2', poolId, 'QmCid1', ['0x' + '11'.repeat(20), zeroBatch]],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'InvalidBatchId()'`);

			// The whole tx rolled back: the implicitly-created pool (and survey) did
			// not persist despite _createPool having run before the batch loop.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'poolExists',
					args: [poolId],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'surveyExists',
					args: ['s1'],
				}),
			).toEqual(false);
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

	describe('multi-pool ordering invariants (getSafePools / getPoolBatches)', function () {
		it('orders getSafePools per safe in creation order and isolates pools by safe', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safeA = unnamedAccounts[0];
			const safeB = unnamedAccounts[1];

			// Interleave pool creation across the two safes.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a1', 'p-a-1', 'QmCidA', []],
				account: safeA,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b1', 'p-b-1', 'QmCidB', []],
				account: safeB,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a2', 'p-a-2', 'QmCidA2', []],
				account: safeA,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b2', 'p-b-2', 'QmCidB2', []],
				account: safeB,
			});

			// safePools preserves creation order per safe.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getSafePools',
					args: [safeA],
				}),
			).toEqual(['p-a-1', 'p-a-2']);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getSafePools',
					args: [safeB],
				}),
			).toEqual(['p-b-1', 'p-b-2']);

			// Each safe's pool list is fully isolated from the other safe's.
			const safeBList = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSafePools',
				args: [safeB],
			});
			expect(safeBList.includes('p-a-1')).toEqual(false);
			expect(safeBList.includes('p-a-2')).toEqual(false);
		});

		it('aggregates getPoolBatches in push order across bootstrap and registerBatch', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolA = 'pool-order-a';
			const poolB = 'pool-order-b';
			const b1 = '0x' + '11'.repeat(20);
			const b2 = '0x' + '22'.repeat(20);
			const b3 = '0x' + '33'.repeat(20);
			const b4 = '0x' + '44'.repeat(20);

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a1', poolA, 'QmCidA', [b1, b2]],
				account: safe,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b1', poolB, 'QmCidB', [b4]],
				account: safe,
			});
			// A later print run appends to pool A via registerBatch.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'registerBatch',
				args: [poolA, b3],
				account: safe,
			});

			// Bootstrap order first, then registerBatch order.
			expect(
				(
					await env.read(S3ntimentSurveyStore, {
						functionName: 'getPoolBatches',
						args: [poolA],
					})
				).map((b) => b.toLowerCase()),
			).toEqual([b1.toLowerCase(), b2.toLowerCase(), b3.toLowerCase()]);

			// Per-pool isolation: pool B only has its own batch.
			expect(
				(
					await env.read(S3ntimentSurveyStore, {
						functionName: 'getPoolBatches',
						args: [poolB],
					})
				).map((b) => b.toLowerCase()),
			).toEqual([b4.toLowerCase()]);
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

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, nullifier, batchAddress);
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
					args: [poolId, nullifier, batchAddress],
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

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const members = [unnamedAccounts[3], unnamedAccounts[4]];
			for (let i = 0; i < members.length; i++) {
				const member = members[i];
				const nullifier = `card-${i}`;
				const signature = await signCardMessage(batchWallet, context, nullifier, batchAddress);
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

			const context = cardContext(S3ntimentSurveyStore.address, poolA);
			const signature = await signCardMessage(batchWallet, context, 'card-scope', batchAddress);
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
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(wrongSigner, context, 'card-sig', batchAddress);

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

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, nullifier, batchAddress);

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
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			let signature = await signCardMessage(batchWallet, context, 'card-1', batchAddress);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				'card-1',
				batchAddress,
				signature,
			]);

			// second join with a fresh, valid card still reverts
			signature = await signCardMessage(batchWallet, context, 'card-2', batchAddress);
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
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, 'card-eoa', batchAddress);
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

		it('reverts when a valid-length signature has an out-of-range v (Invalid signature recovery value)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-v';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			// 65-byte signature (valid length) whose v byte is outside {27, 28}.
			// v = 0x02 -> adjusted to 29 (not 27/28), so recovery must revert.
			const r = '0x' + 'aa'.repeat(32);
			const s = '0x' + 'bb'.repeat(32);
			const badVSignature = r + s.slice(2) + '02';
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-v',
					batchAddress,
					badVSignature,
				]),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'Invalid signature recovery value'`,
			);
		});

		it('accepts signatures whose raw v is 0 or 1 (adjusted to 27/28) and recovers the batch wallet', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const secondWallet = unnamedAccounts[4];
			const poolId = 'pool-reg-lowv';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			// _recoverSigner: `if (v < 27) v += 27` lifts a raw v of 0 → 27 and
			// 1 → 28, recovering the SAME signer as the canonical 27/28 path. Mutate
			// the trailing v byte of each card to its raw low value (v - 27).
			// card-lowv-0 naturally signs with v=27 (→ low 0) and card-lowv-1 with
			// v=28 (→ low 1), deterministically covering both low-v edges.
			const nullifiers = ['card-lowv-0', 'card-lowv-1'];
			const members = [poolWallet, secondWallet];
			const lowVs = new Set<number>();
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			for (let i = 0; i < members.length; i++) {
				const sig = await signCardMessage(batchWallet, context, nullifiers[i], batchAddress);
				const v = parseInt(sig.slice(-2), 16); // canonical v: 27 or 28
				const lowV = v - 27; // 0 or 1
				lowVs.add(lowV);
				const lowVSignature = (sig.slice(0, -2) + lowV.toString(16).padStart(2, '0')) as `0x${string}`;

				const mockSmc = await viem.deployContract('MockSMC', [members[i]]);
				await mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					nullifiers[i],
					batchAddress,
					lowVSignature,
				]);
			}

			// Both low-v values (0 and 1) were exercised, each recovering the batch wallet.
			expect([...lowVs].sort()).toEqual([0, 1]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, poolWallet],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, secondWallet],
				}),
			).toEqual(true);
			const batchData = await env.read(S3ntimentSurveyStore, {
				functionName: 'getBatch',
				args: [poolId, batchAddress],
			});
			expect(batchData[1]).toEqual(2n);
		});

		it('reverts when the raw v byte is 26 (adjusted to 53, not 27 — so recovery is refused)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-reg-v26';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, 'card-v26', batchAddress);
			// v = 0x1a = 26. The coverage audit's premise was "v=26 → 27 valid", but per
			// the source `if (v < 27) v += 27` maps 26 → 53, which fails
			// `require(v == 27 || v == 28)`. This test pins the REAL behaviour: revert.
			const v26Signature = (signature.slice(0, -2) + '1a') as `0x${string}`;

			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-v26',
					batchAddress,
					v26Signature,
				]),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'Invalid signature recovery value'`,
			);
		});

		it('returns false for an unused nullifier (default state)', async function () {
			const {env, S3ntimentSurveyStore} =
				await networkHelpers.loadFixture(deployAll);
			// A nullifier/batch that has never been used should default to false.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: ['pool-x', 'never-used-card', '0x' + '99'.repeat(20)],
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

		// -------------------------------------------------------------------
		// CARD-V2 — regression tests pinning the audit fixes (#1, #6, #7).
		// -------------------------------------------------------------------

		it('does not let a card signed for pool A be redeemed in a different pool B (cross-pool redemption fails)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolA = 'pool-cross-a';
			const poolB = 'pool-cross-b';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			// The same batch wallet is registered in BOTH pools, so the only
			// thing stopping a cross-pool redemption is the per-pool digest.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a1', poolA, 'QmCidA', [batchAddress]],
				account: safe,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b1', poolB, 'QmCidB', [batchAddress]],
				account: safe,
			});

			// The card is signed for pool A only (digest embeds poolA).
			const contextA = cardContext(S3ntimentSurveyStore.address, poolA);
			const signature = await signCardMessage(batchWallet, contextA, 'cross-card', batchAddress);
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);

			// Redeeming the pool-A-signed card in pool B: registerInPool recomputes
			// the digest with poolB embedded, which does not match what was signed
			// (poolA) — recovery yields a signer != batchId -> InvalidSignature.
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolB,
					'cross-card',
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);

			// The intended pool-A redemption STILL succeeds afterwards: the failed
			// wrong-pool attempt did not burn the nullifier usable in pool A.
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolA,
				'cross-card',
				batchAddress,
				signature,
			]);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolA, poolWallet],
				}),
			).toEqual(true);
			// Against pool B the same nullifier was never touched.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolB, 'cross-card', batchAddress],
				}),
			).toEqual(false);
		});

		it('keeps nullifiers independent per pool: burned in pool A, still redeemable in pool B', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWalletA = unnamedAccounts[3];
			const poolWalletB = unnamedAccounts[4];
			const poolA = 'pool-null-a';
			const poolB = 'pool-null-b';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const nullifier = 'shared-nullifier';

			// Same batch wallet registered in both pools.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['a1', poolA, 'QmCidA', [batchAddress]],
				account: safe,
			});
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['b1', poolB, 'QmCidB', [batchAddress]],
				account: safe,
			});

			const contextA = cardContext(S3ntimentSurveyStore.address, poolA);
			const contextB = cardContext(S3ntimentSurveyStore.address, poolB);

			// Redeem the SAME (nullifier, batchId) card in pool A (signed for A).
			const sigA = await signCardMessage(batchWallet, contextA, nullifier, batchAddress);
			const smcA = await viem.deployContract('MockSMC', [poolWalletA]);
			await smcA.write.register([
				S3ntimentSurveyStore.address,
				poolA,
				nullifier,
				batchAddress,
				sigA,
			]);

			// Burned in pool A...
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolA, nullifier, batchAddress],
				}),
			).toEqual(true);

			// ...yet the SAME nullifier is still usable in pool B (signed for B).
			const sigB = await signCardMessage(batchWallet, contextB, nullifier, batchAddress);
			const smcB = await viem.deployContract('MockSMC', [poolWalletB]);
			await smcB.write.register([
				S3ntimentSurveyStore.address,
				poolB,
				nullifier,
				batchAddress,
				sigB,
			]);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolB, poolWalletB],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolB, nullifier, batchAddress],
				}),
			).toEqual(true);
		});

		it('reverts when the SMC owner is a zero address (InvalidMemberAddress)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-reg-zero-owner';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, 'card-zero', batchAddress);

			// A malicious SMC whose owner() returns address(0).
			const mockSmc = await viem.deployContract('MockSMC', [
				'0x0000000000000000000000000000000000000000',
			]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-zero',
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidMemberAddress()'`);

			// The whole tx reverted — the empty owner check runs BEFORE writing
			// membership, and the revert rolls back the nullifier burn, so the card
			// is NOT marked used and can still be redeemed by a good SMC.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolId, 'card-zero', batchAddress],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, '0x0000000000000000000000000000000000000000'],
				}),
			).toEqual(false);
		});
	});

	describe('revokeMember (Safe-gated governance)', function () {
		// Register a member via a valid card so revokeMember has a real member to
		// remove. Mirrors the membership setup used in the registerInPool tests.
		async function registerMember({env, S3ntimentSurveyStore, poolId, member, safe}) {
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			// Unique surveyId per call so the same member can join multiple pools.
			const surveyId = 'revoke-srv-' + poolId;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: [surveyId, poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, 'card-revoke-' + poolId, batchAddress);
			const mockSmc = await viem.deployContract('MockSMC', [member]);
			await mockSmc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				'card-revoke-' + poolId,
				batchAddress,
				signature,
			]);
		}

		it('lets the pool Safe revoke a registered member (isPoolMember -> false)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const member = unnamedAccounts[3];
			const poolId = 'pool-revoke';
			await registerMember({env, S3ntimentSurveyStore, poolId, member, safe});

			// Member is registered before the revoke.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, member],
				}),
			).toEqual(true);

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeMember',
				args: [poolId, member],
				account: safe,
			});

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, member],
				}),
			).toEqual(false);
		});

		it('reverts revokeMember when called by a non-safe (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			const member = unnamedAccounts[3];
			const poolId = 'pool-revoke-auth';
			await registerMember({env, S3ntimentSurveyStore, poolId, member, safe});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'revokeMember',
					args: [poolId, member],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('reverts revokeMember for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'revokeMember',
					args: ['ghost-pool', unnamedAccounts[3]],
					account: unnamedAccounts[0],
				}),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});

		it('idempotently no-ops revoking an already-unregistered member', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const member = unnamedAccounts[3];
			const poolId = 'pool-revoke-idempotent';
			await registerMember({env, S3ntimentSurveyStore, poolId, member, safe});

			// First revoke removes the member.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeMember',
				args: [poolId, member],
				account: safe,
			});
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, member],
				}),
			).toEqual(false);

			// Revoking the same member again (already unregistered) is a safe no-op.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeMember',
				args: [poolId, member],
				account: safe,
			});
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, member],
				}),
			).toEqual(false);
		});

		it('does not revoke the member in another pool (membership stays scoped)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const member = unnamedAccounts[3];
			const poolA = 'pool-revoke-scope-a';
			const poolB = 'pool-revoke-scope-b';
			// Same member joins both pools (two separate cards).
			await registerMember({env, S3ntimentSurveyStore, poolId: poolA, member, safe});
			await registerMember({env, S3ntimentSurveyStore, poolId: poolB, member, safe});

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeMember',
				args: [poolA, member],
				account: safe,
			});

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolA, member],
				}),
			).toEqual(false);
			// Membership in the other pool is untouched.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolB, member],
				}),
			).toEqual(true);
		});
	});
});
