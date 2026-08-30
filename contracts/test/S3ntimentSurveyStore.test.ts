import {expect} from 'earl';
import {describe, it} from 'node:test';
import {network} from 'hardhat';
import {
	concat,
	encodeAbiParameters,
	keccak256,
	parseAbiParameters,
	stringToBytes,
	toBytes,
} from 'viem';
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

// A fresh deterministic leaf keypair (the member's stealth leaf / old leaf).
function createLeaf(byte = 'bb') {
	return privateKeyToAccount('0x' + byte.repeat(32));
}

// Builds the rotateMember digest + EIP-191 personal-sign signature exactly as
// S3ntimentSurveyStore.rotateMember does on-chain:
//   digest = keccak256(abi.encode(poolId, oldLeaf, newLeaf, storeAddress, chainId))
//   ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" ++ digest)
//   signature = account.sign(ethSignedHash)
// abi.encode (== encodeAbiParameters) is required so it matches the on-chain
// digest byte-for-byte with two dynamic fields (poolId string).
async function signRotateMessage(
	account: ReturnType<typeof privateKeyToAccount>,
	storeAddress: string,
	poolId: string,
	oldLeaf: string,
	newLeaf: string,
	chainId: bigint,
): Promise<`0x${string}`> {
	const digest = keccak256(
		encodeAbiParameters(
			parseAbiParameters('string,address,address,address,uint256'),
			[
				poolId,
				oldLeaf as `0x${string}`,
				newLeaf as `0x${string}`,
				storeAddress as `0x${string}`,
				chainId,
			],
		),
	);
	const ethSignedHash = keccak256(
		concat([stringToBytes('\x19Ethereum Signed Message:\n32'), toBytes(digest)]),
	);
	return account.sign!({hash: ethSignedHash});
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

		it('reverts when batchIds are passed to an existing pool (InvalidBatchIds)', async function () {
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
			// Audit #9: a non-empty batchIds array on an EXISTING pool is a caller
			// mistake — it must revert explicitly, not be silently dropped (cards
			// would later revert BatchNotFound at redemption).
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'createSurvey',
					args: ['s2', poolId, 'QmCid2', [batch]],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'InvalidBatchIds()'`);

			// The whole tx reverted: the survey was NOT added...
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'surveyExists',
					args: ['s2'],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveys',
					args: [poolId],
				}),
			).toEqual(['s1']);
			// ...and no batch was registered.
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

		it('still lets the Safe add a survey to an existing pool with an empty batchIds array', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-ignore-batch-empty';

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});
			// An EMPTY batchIds array on an existing pool stays valid (no-op guard).
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s2', poolId, 'QmCid2', []],
				account: safe,
			});

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveys',
					args: [poolId],
				}),
			).toEqual(['s1', 's2']);
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

		it('reverts when updating a survey with an empty CID (IPFS CID cannot be empty)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', 'pool-up-empty-cid', 'QmCid1', []],
				account: safe,
			});

			// updateSurvey mirrors createSurvey: an empty CID must revert (audit #8).
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'updateSurvey',
					args: ['s1', ''],
					account: safe,
				}),
			).toBeRejectedWith(
				`VM Exception while processing transaction: reverted with reason string 'IPFS CID cannot be empty'`,
			);

			// The original CID is untouched by the reverted update.
			const survey = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSurvey',
				args: ['s1'],
			});
			expect(survey[0]).toEqual('QmCid1');
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

	describe('getPoolSurveysSince (view)', function () {
		// Create a survey at an explicit block timestamp (vm.warp-style control via
		// networkHelpers.time.setNextBlockTimestamp — createdAt = block.timestamp
		// at create). Returns the stored survey tuple [ipfsCid, poolId, createdAt].
		async function createSurveyAt({env, S3ntimentSurveyStore, poolId, surveyId, ipfsCid, timestamp, safe}) {
			await networkHelpers.time.setNextBlockTimestamp(timestamp);
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: [surveyId, poolId, ipfsCid, []],
				account: safe,
			});
			return await env.read(S3ntimentSurveyStore, {
				functionName: 'getSurvey',
				args: [surveyId],
			});
		}

		it('returns an empty array for an unknown pool (no revert)', async function () {
			const {env, S3ntimentSurveyStore} =
				await networkHelpers.loadFixture(deployAll);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: ['ghost-pool', 0n],
				}),
			).toEqual([]);
		});

		it('filters surveys strictly after `since` (before / at / after)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-since-filter';
			const t0 = await networkHelpers.time.latest();

			// Distinct creates: s1 at t0+10, s2 at t0+20, s3 at t0+30.
			const s1 = await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 's1',
				ipfsCid: 'QmCid1',
				timestamp: t0 + 10,
				safe,
			});
			const s2 = await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 's2',
				ipfsCid: 'QmCid2',
				timestamp: t0 + 20,
				safe,
			});
			const s3 = await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 's3',
				ipfsCid: 'QmCid3',
				timestamp: t0 + 30,
				safe,
			});

			// Sanity: distinct, ascending createdAt values were recorded.
			expect(s1[2]).toEqual(BigInt(t0 + 10));
			expect(s2[2]).toEqual(BigInt(t0 + 20));
			expect(s3[2]).toEqual(BigInt(t0 + 30));

			// since == s2.createdAt: s1 (before) and s2 (at) are excluded, s3
			// (after) is kept — the comparison is STRICTLY greater-than.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: [poolId, s2[2]],
				}),
			).toEqual([{id: 's3', ipfsCid: 'QmCid3', createdAt: s3[2]}]);

			// since == s1.createdAt: s1 (at) excluded, s2 + s3 kept in insertion order.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: [poolId, s1[2]],
				}),
			).toEqual([
				{id: 's2', ipfsCid: 'QmCid2', createdAt: s2[2]},
				{id: 's3', ipfsCid: 'QmCid3', createdAt: s3[2]},
			]);

			// since == s3.createdAt: s3 (at) excluded -> empty.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: [poolId, s3[2]],
				}),
			).toEqual([]);
		});

		it('only returns the requested pool\'s surveys (pools isolated)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const t0 = await networkHelpers.time.latest();

			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId: 'pool-a',
				surveyId: 'a1',
				ipfsCid: 'QmCidA',
				timestamp: t0 + 10,
				safe,
			});
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId: 'pool-b',
				surveyId: 'b1',
				ipfsCid: 'QmCidB',
				timestamp: t0 + 20,
				safe,
			});
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId: 'pool-a',
				surveyId: 'a2',
				ipfsCid: 'QmCidA2',
				timestamp: t0 + 30,
				safe,
			});

			// Pool A's results never include pool B's survey — even though b1's
			// timestamp (t0+20) lies between a1's (t0+10) and a2's (t0+30).
			const poolASinceA1 = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveysSince',
				args: ['pool-a', BigInt(t0 + 10)],
			});
			expect(poolASinceA1.map((r) => r.id)).toEqual(['a2']);

			const poolAAll = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveysSince',
				args: ['pool-a', 0n],
			});
			expect(poolAAll.map((r) => r.id)).toEqual(['a1', 'a2']);
			expect(poolAAll.some((r) => r.id === 'b1')).toEqual(false);

			const poolBAll = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveysSince',
				args: ['pool-b', 0n],
			});
			expect(poolBAll.map((r) => r.id)).toEqual(['b1']);
		});

		it('populates SurveyRef fields (id / ipfsCid / createdAt)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-since-fields';
			const t0 = await networkHelpers.time.latest();
			const timestamp = t0 + 42;
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'field-srv',
				ipfsCid: 'QmFieldCid',
				timestamp,
				safe,
			});

			const refs = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveysSince',
				args: [poolId, 0n],
			});
			expect(refs).toEqual([{id: 'field-srv', ipfsCid: 'QmFieldCid', createdAt: BigInt(timestamp)}]);
			expect(refs[0].id).toEqual('field-srv');
			expect(refs[0].ipfsCid).toEqual('QmFieldCid');
			expect(refs[0].createdAt).toEqual(BigInt(timestamp));

			// Cross-check against getSurvey (the source of truth for these fields).
			const survey = await env.read(S3ntimentSurveyStore, {
				functionName: 'getSurvey',
				args: ['field-srv'],
			});
			expect(refs[0].ipfsCid).toEqual(survey[0]);
			expect(refs[0].createdAt).toEqual(survey[2]);
		});

		it('returns all surveys in insertion order when all are in range', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-since-all';
			const t0 = await networkHelpers.time.latest();
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'all-1',
				ipfsCid: 'QmAll1',
				timestamp: t0 + 10,
				safe,
			});
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'all-2',
				ipfsCid: 'QmAll2',
				timestamp: t0 + 20,
				safe,
			});
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'all-3',
				ipfsCid: 'QmAll3',
				timestamp: t0 + 30,
				safe,
			});

			// since below every createdAt -> everything, in insertion order (NOT sorted).
			const refs = await env.read(S3ntimentSurveyStore, {
				functionName: 'getPoolSurveysSince',
				args: [poolId, BigInt(t0)],
			});
			expect(refs.map((r) => r.id)).toEqual(['all-1', 'all-2', 'all-3']);
			expect(refs.map((r) => r.createdAt)).toEqual([
				BigInt(t0 + 10),
				BigInt(t0 + 20),
				BigInt(t0 + 30),
			]);
		});

		it('returns an empty array when no survey is in range', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-since-none';
			const t0 = await networkHelpers.time.latest();
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'none-1',
				ipfsCid: 'QmNone1',
				timestamp: t0 + 10,
				safe,
			});
			await createSurveyAt({
				env,
				S3ntimentSurveyStore,
				poolId,
				surveyId: 'none-2',
				ipfsCid: 'QmNone2',
				timestamp: t0 + 20,
				safe,
			});

			// since == the newest createdAt -> strictly-after match excludes it.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: [poolId, BigInt(t0 + 20)],
				}),
			).toEqual([]);
			// A far-future `since` also returns nothing.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'getPoolSurveysSince',
					args: [poolId, BigInt(t0 + 9999)],
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

	describe('revokeBatch (Safe-gated governance)', function () {
		// Set up a pool with one batch wallet and return the signing material.
		async function setupBatch({env, S3ntimentSurveyStore, poolId, safe}) {
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const surveyId = 'revoke-batch-srv-' + poolId;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: [surveyId, poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});
			return {batchWallet, batchAddress};
		}

		it('reverts revokeBatch when called by a non-safe (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			const poolId = 'pool-revoke-batch-auth';
			const {batchAddress} = await setupBatch({env, S3ntimentSurveyStore, poolId, safe});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'revokeBatch',
					args: [poolId, batchAddress],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('reverts revokeBatch for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'revokeBatch',
					args: ['ghost-pool', '0x' + '11'.repeat(20)],
					account: unnamedAccounts[0],
				}),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});

		it('reverts revokeBatch for a never-registered batch (BatchNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-revoke-batch-missing';
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'revokeBatch',
					args: [poolId, '0x' + '55'.repeat(20)],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'BatchNotFound()'`);
		});

		it('lets the Safe revoke a batch; subsequent registration reverts (BatchRevoked) without burning the nullifier', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolId = 'pool-revoke-batch';
			const {batchWallet, batchAddress} = await setupBatch({env, S3ntimentSurveyStore, poolId, safe});

			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeBatch',
				args: [poolId, batchAddress],
				account: safe,
			});

			// A valid card from the revoked batch can no longer be redeemed.
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(batchWallet, context, 'card-revoked', batchAddress);
			const mockSmc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-revoked',
					batchAddress,
					signature,
				]),
			).toBeRejectedWith(`custom error 'BatchRevoked()'`);

			// The whole tx reverted BEFORE any nullifier work — the card's
			// nullifier is NOT burned and the wallet is not a member.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolId, 'card-revoked', batchAddress],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, poolWallet],
				}),
			).toEqual(false);
		});

		it('keeps batch revocation scoped per pool (same batch address in pool B unaffected)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolWallet = unnamedAccounts[3];
			const poolA = 'pool-revoke-batch-scope-a';
			const poolB = 'pool-revoke-batch-scope-b';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;

			// The same batch wallet is registered in both pools.
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

			// Revoke the batch in pool A only.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeBatch',
				args: [poolA, batchAddress],
				account: safe,
			});

			// Redeeming in pool A reverts (BatchRevoked).
			const contextA = cardContext(S3ntimentSurveyStore.address, poolA);
			const sigA = await signCardMessage(batchWallet, contextA, 'card-scope-a', batchAddress);
			const smc = await viem.deployContract('MockSMC', [poolWallet]);
			await expect(
				smc.write.register([
					S3ntimentSurveyStore.address,
					poolA,
					'card-scope-a',
					batchAddress,
					sigA,
				]),
			).toBeRejectedWith(`custom error 'BatchRevoked()'`);

			// The same batch address in pool B is untouched — redemption succeeds.
			const contextB = cardContext(S3ntimentSurveyStore.address, poolB);
			const sigB = await signCardMessage(batchWallet, contextB, 'card-scope-b', batchAddress);
			await smc.write.register([
				S3ntimentSurveyStore.address,
				poolB,
				'card-scope-b',
				batchAddress,
				sigB,
			]);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolB, poolWallet],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolB, 'card-scope-b', batchAddress],
				}),
			).toEqual(true);
		});

		it('idempotently no-ops a double revoke', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-revoke-batch-double';
			const {batchAddress} = await setupBatch({env, S3ntimentSurveyStore, poolId, safe});

			// First revoke sets the revoked flag.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeBatch',
				args: [poolId, batchAddress],
				account: safe,
			});
			// Revoking again is a safe no-op (idempotent, mirroring revokeMember).
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'revokeBatch',
				args: [poolId, batchAddress],
				account: safe,
			});
		});
	});

	describe('setBatchMaxCards (per-batch card cap)', function () {
		it('lets the Safe set a cap and blocks registration one card past the cap', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-cap';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});

			// Cap this batch at 2 cards.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'setBatchMaxCards',
				args: [poolId, batchAddress, 2],
				account: safe,
			});

			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const members = [unnamedAccounts[3], unnamedAccounts[4]];
			for (let i = 0; i < members.length; i++) {
				const nullifier = `card-cap-${i}`;
				const signature = await signCardMessage(batchWallet, context, nullifier, batchAddress);
				const mockSmc = await viem.deployContract('MockSMC', [members[i]]);
				await mockSmc.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					nullifier,
					batchAddress,
					signature,
				]);
			}

			// cardCount reached the cap (2) — both members registered.
			const batchData = await env.read(S3ntimentSurveyStore, {
				functionName: 'getBatch',
				args: [poolId, batchAddress],
			});
			expect(batchData[1]).toEqual(2n);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, members[0]],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, members[1]],
				}),
			).toEqual(true);

			// A third card — one past the cap — reverts and does not burn its nullifier.
			const overCapMember = unnamedAccounts[5];
			const sigOver = await signCardMessage(batchWallet, context, 'card-cap-2', batchAddress);
			const smcOver = await viem.deployContract('MockSMC', [overCapMember]);
			await expect(
				smcOver.write.register([
					S3ntimentSurveyStore.address,
					poolId,
					'card-cap-2',
					batchAddress,
					sigOver,
				]),
			).toBeRejectedWith(`custom error 'BatchMaxCardsReached()'`);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isNullifierUsed',
					args: [poolId, 'card-cap-2', batchAddress],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, overCapMember],
				}),
			).toEqual(false);
		});

		it('reverts setBatchMaxCards when called by a non-safe (NotPoolSafe)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const nonSafe = unnamedAccounts[1];
			const poolId = 'pool-cap-auth';
			const batch = '0x' + '66'.repeat(20);
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batch]],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'setBatchMaxCards',
					args: [poolId, batch, 10],
					account: nonSafe,
				}),
			).toBeRejectedWith(`custom error 'NotPoolSafe()'`);
		});

		it('reverts setBatchMaxCards for a never-registered batch (BatchNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const poolId = 'pool-cap-missing';
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', []],
				account: safe,
			});

			await expect(
				env.execute(S3ntimentSurveyStore, {
					functionName: 'setBatchMaxCards',
					args: [poolId, '0x' + '77'.repeat(20), 10],
					account: safe,
				}),
			).toBeRejectedWith(`custom error 'BatchNotFound()'`);
		});
	describe('rotateMember (self-authorizing membership rotation)', function () {
		// Set up a pool, register `leaf` as a member (via a valid card + SMC whose
		// owner is the leaf), and return the SMC. Mirrors the registerInPool setup.
		async function setupLeafMember({
			env,
			S3ntimentSurveyStore,
			safe,
			poolId,
			leaf,
		}) {
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			const surveyId = 'rotate-srv-' + poolId;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: [surveyId, poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});
			const context = cardContext(S3ntimentSurveyStore.address, poolId);
			const signature = await signCardMessage(
				batchWallet,
				context,
				'card-rotate-' + poolId,
				batchAddress,
			);
			const smc = await viem.deployContract('MockSMC', [leaf.address]);
			await smc.write.register([
				S3ntimentSurveyStore.address,
				poolId,
				'card-rotate-' + poolId,
				batchAddress,
				signature,
			]);
			return {smc, batchAddress};
		}

		it('rotates a current member to a new leaf (old out, new in)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('11');
			const newLeaf = createLeaf('22');
			const poolId = 'pool-rotate-ok';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, oldLeaf.address],
				}),
			).toEqual(true);

			const signature = await signRotateMessage(
				oldLeaf,
				S3ntimentSurveyStore.address,
				poolId,
				oldLeaf.address,
				newLeaf.address,
				CHAIN_ID,
			);
			await smc.write.rotate([
				S3ntimentSurveyStore.address,
				poolId,
				newLeaf.address,
				signature,
			]);

			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, oldLeaf.address],
				}),
			).toEqual(false);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, newLeaf.address],
				}),
			).toEqual(true);
		});

		it('rejects a caller not controlling the old leaf (signature from a different key)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('33');
			const otherKey = createLeaf('44');
			const newLeaf = createLeaf('55');
			const poolId = 'pool-rotate-wrong-signer';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			// The SMC owner is oldLeaf, but the signature is produced by a DIFFERENT
			// key (otherKey). The recovered signer != ISMC(msg.sender).owner() ->
			// InvalidSignature. A holder of any single leaf cannot therefore rotate
			// a DIFFERENT member's membership away.
			const signature = await signRotateMessage(
				otherKey,
				S3ntimentSurveyStore.address,
				poolId,
				oldLeaf.address,
				newLeaf.address,
				CHAIN_ID,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					newLeaf.address,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);

			// Nothing changed: old leaf still a member, new leaf not.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, oldLeaf.address],
				}),
			).toEqual(true);
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, newLeaf.address],
				}),
			).toEqual(false);
		});

		it('rejects rotation when the old leaf is not a member (NotPoolMember)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const stranger = createLeaf('66'); // SMC owner, but never registered
			const newLeaf = createLeaf('77');
			const poolId = 'pool-rotate-not-member';
			const batchWallet = createBatchWallet();
			const batchAddress = batchWallet.address;
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s1', poolId, 'QmCid1', [batchAddress]],
				account: safe,
			});
			const smc = await viem.deployContract('MockSMC', [stranger.address]);

			// Signature is valid and recovers to the SMC owner (stranger), but
			// stranger is not a member of the pool -> NotPoolMember.
			const signature = await signRotateMessage(
				stranger,
				S3ntimentSurveyStore.address,
				poolId,
				stranger.address,
				newLeaf.address,
				CHAIN_ID,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					newLeaf.address,
					signature,
				]),
			).toBeRejectedWith(`custom error 'NotPoolMember()'`);
		});

		it('rejects rotation to a zero newLeaf (InvalidRotationTarget)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('88');
			const poolId = 'pool-rotate-zero-target';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			const zeroLeaf = '0x' + '00'.repeat(20);
			const signature = await signRotateMessage(
				oldLeaf,
				S3ntimentSurveyStore.address,
				poolId,
				oldLeaf.address,
				zeroLeaf,
				CHAIN_ID,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					zeroLeaf,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidRotationTarget()'`);
		});

		it('blocks replay of a successful rotation (old leaf no longer a member)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('99');
			const newLeaf = createLeaf('ab');
			const poolId = 'pool-rotate-replay';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			const signature = await signRotateMessage(
				oldLeaf,
				S3ntimentSurveyStore.address,
				poolId,
				oldLeaf.address,
				newLeaf.address,
				CHAIN_ID,
			);
			await smc.write.rotate([
				S3ntimentSurveyStore.address,
				poolId,
				newLeaf.address,
				signature,
			]);

			// Same signature replayed — oldLeaf is no longer a member -> NotPoolMember.
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					newLeaf.address,
					signature,
				]),
			).toBeRejectedWith(`custom error 'NotPoolMember()'`);

			// The swap is stable: new leaf remained the sole member.
			expect(
				await env.read(S3ntimentSurveyStore, {
					functionName: 'isPoolMember',
					args: [poolId, newLeaf.address],
				}),
			).toEqual(true);
		});

		it('rejects a signature bound to a wrong poolId', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('bc');
			const newLeaf = createLeaf('cd');
			const poolId = 'pool-rotate-wrong-pool';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			// signed over a DIFFERENT poolId than the on-chain digest uses -> the
			// recovered signer will not equal the SMC owner -> InvalidSignature.
			const signature = await signRotateMessage(
				oldLeaf,
				S3ntimentSurveyStore.address,
				'wrong-pool-' + poolId,
				oldLeaf.address,
				newLeaf.address,
				CHAIN_ID,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					newLeaf.address,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);
		});

		it('rejects a signature bound to a wrong chainId', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const oldLeaf = createLeaf('de');
			const newLeaf = createLeaf('ef');
			const poolId = 'pool-rotate-wrong-chain';
			const {smc} = await setupLeafMember({
				env,
				S3ntimentSurveyStore,
				safe,
				poolId,
				leaf: oldLeaf,
			});

			// Signed over a bumped chainId -> recovered signer != SMC owner ->
			// InvalidSignature. Proves the chain binding blocks cross-chain replay.
			const signature = await signRotateMessage(
				oldLeaf,
				S3ntimentSurveyStore.address,
				poolId,
				oldLeaf.address,
				newLeaf.address,
				CHAIN_ID + 1n,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					newLeaf.address,
					signature,
				]),
			).toBeRejectedWith(`custom error 'InvalidSignature()'`);
		});

		it('rejects rotation for an unknown pool (PoolNotFound)', async function () {
			const {env, S3ntimentSurveyStore, unnamedAccounts} =
				await networkHelpers.loadFixture(deployAll);
			const safe = unnamedAccounts[0];
			const leaf = createLeaf('fa');
			const poolId = 'pool-rotate-missing';
			// Create an unrelated pool so the fixture has at least one pool; the
			// rotation targets an unknown poolId.
			await env.execute(S3ntimentSurveyStore, {
				functionName: 'createSurvey',
				args: ['s-other', 'pool-other', 'QmCid1', []],
				account: safe,
			});
			const smc = await viem.deployContract('MockSMC', [leaf.address]);
			const signature = await signRotateMessage(
				leaf,
				S3ntimentSurveyStore.address,
				poolId,
				leaf.address,
				'0x' + '11'.repeat(20),
				CHAIN_ID,
			);
			await expect(
				smc.write.rotate([
					S3ntimentSurveyStore.address,
					poolId,
					'0x' + '11'.repeat(20),
					signature,
				]),
			).toBeRejectedWith(`custom error 'PoolNotFound()'`);
		});
	});

	});
});
