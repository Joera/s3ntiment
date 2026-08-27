import { createSurveyAggregationQuery, createSurveyCollectionSchema, EncryptedConfig, fetchSurveyAndParseCid, isScored, PoolConfig, withRetry } from "@s3ntiment/shared";
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
import { calculateScore, stripScoring } from "@s3ntiment/shared";
import { NillionPkpClient } from "./services/nildb.pkp.service.js";

export class SurveyController {
    private nildb: any;
    private lit: any;
    private litPoolKeys: any;
    private ipfs: any;
    private viem: any;

    constructor(nildb: any, lit: any, litPoolKeys: any, ipfs: any, viem: any) {
        this.nildb = nildb;
        this.lit = lit;
        this.litPoolKeys = litPoolKeys;
        this.ipfs = ipfs;
        this.viem = viem;
    }

    // Authorization is enforced on-chain: for new pools, the caller becomes the owner;
    // for existing pools, the contract reverts if msg.sender != pool.safe.
    async create(body: any) {

        const contract = surveyStore.address;
        const { signature, userAddress, surveyConfig } = body;
        const { pkpId, pkpDid } = surveyConfig.config;

        const usage_api_key = await this.litPoolKeys.get(surveyConfig.pool)

        const { safeConfigWithScoring, safeConfig, scoring } = stripScoring(surveyConfig)
        const _isScored = isScored(surveyConfig.groups);
        const rawSchema = createSurveyCollectionSchema(safeConfig, "owned")

        const nillPkp = new NillionPkpClient(this.lit, surveyConfig.pool, surveyConfig.config.safe, contract)
        const collectionResponse = await nillPkp.createCollection(signature, userAddress, pkpId, pkpDid, usage_api_key, rawSchema);
        console.log("collectionResponse", collectionResponse);

        // await nillPkp.getCollection(pkpId, pkpDid, usage_api_key, surveyConfig.id) 
        // const collections = await nillPkp.listCollections(pkpId, pkpDid, usage_api_key);
        // console.log('Existing collections:', collections);


        // Create aggregation query
        const queryDef = createSurveyAggregationQuery(surveyConfig.id, surveyConfig.groups);
        const queryResponse = await nillPkp.createQuery(signature, userAddress, pkpId, pkpDid, usage_api_key, queryDef);

        surveyConfig.config.queryIds = [queryDef._id];

        const [ encryptedForOwner, encryptedForRespondent] = await Promise.all([
            this.lit.encrypt(usage_api_key, pkpId, JSON.stringify(safeConfigWithScoring)),
            this.lit.encrypt(usage_api_key, pkpId, JSON.stringify(safeConfig))
        ])

        const encryptedScoring = this.nildb.encryptToBuilder({scoring: scoring, groups: surveyConfig.groups});

        const config: EncryptedConfig = {
            ...surveyConfig,
            nilDid: this.nildb.builderDid.didString,
            encryptedForOwner,
            encryptedForRespondent,
            encryptedScoring,
            isScored: _isScored
        }

        return await this.ipfs.uploadToPinata(JSON.stringify(config))
    }

    // Authorization is enforced on-chain: for new pools, the caller becomes the owner;
    // for existing pools, the contract reverts if msg.sender != pool.safe.
    async update(body: any) {

        const { survey , poolConfig } = body;

        const usage_api_key = await this.litPoolKeys.get(survey.pool)

        const { safeConfigWithScoring, safeConfig, scoring } = stripScoring(survey);
        const _isScored = isScored(survey.groups);

        const [ encryptedForOwner, encryptedForRespondent] = await Promise.all([
            this.lit.encrypt(usage_api_key, poolConfig.pkpId, JSON.stringify(safeConfigWithScoring)),
            this.lit.encrypt(usage_api_key, poolConfig.pkpId, JSON.stringify(safeConfig))
        ])

        const encryptedScoring = this.nildb.encryptToBuilder({scoring: scoring, groups: survey.groups});

        const config: EncryptedConfig = {
            surveyId: survey.id,
            poolId: survey.pool,
            nilDid: this.nildb.builderDid.didString,
            encryptedForOwner,
            encryptedForRespondent,
            encryptedScoring,
            queryIds: survey.queryIds,
            isScored: _isScored
        }

        return await this.ipfs.uploadToPinata(JSON.stringify(config))
    }

    async get(surveyId: string) {
        const res = await this.viem.read(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            'getSurvey',
            [surveyId]
        );

        const cid = res[0];
        if (!cid) return null;

        console.log("FETCHED CID", cid)

        const raw = await this.ipfs.fetchFromPinata(cid);
        const config = JSON.parse(raw);
        // strip answer key before returning
        const { encryptedScoring, ...safe } = config;
        return safe;
    }


    async score(surveyId: string, signerAddress: string) {

        const res = await this.viem.read(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            'getSurvey',
            [surveyId]
        );

        const cid = res[0];
        const raw = await this.ipfs.fetchFromPinata(cid);
        const config = JSON.parse(raw);

        if (!config.encryptedForOwner) {
            return null;
        }


        // temp solution .. see dilemma in obsidian 
       const { scoring, groups } = this.nildb.decryptFromBuilder(config.encryptedScoring);

       const existingIds = await this.nildb.exists(surveyId, signerAddress)

       if (existingIds[0]) {

            const userData = await this.nildb.getResponseById(surveyId, existingIds[0]);

            console.log(scoring)
            console.log(userData)
            console.log(groups)

            const s = calculateScore(scoring, userData, groups);
            console.log(s)

            return s;

       } else {

        console.log("no entry found")
        return false;

       }
    }

    async getUserDelegation(signature: string, userAddress: string, poolId: string, poolConfig: PoolConfig, surveyId: string, userDid: string, ) {

        const deployment = {
            address: surveyStore.address,
            abi: surveyStore.abi
        }

        const contract = surveyStore.address;
        const usageKey = await this.litPoolKeys.get(poolId);
        const survey = await fetchSurveyAndParseCid( { viem: this.viem, ipfs: this.ipfs }, deployment, surveyId)

        const nillPkp = new NillionPkpClient(this.lit, survey.poolId, poolConfig.safe!, contract)
        return await nillPkp.getUserWriteDelegation(signature, userAddress, surveyId, userDid, poolId, usageKey, poolConfig.pkpId!, poolConfig.pkpDid!);
    }
}