import { compactAction, encryptAction, getDecryptForOwnerAction, getDecryptForRespondentAction, getPkpPublicKeyAction, ownerInvocationAction, publicKeyToDidKey, userDelegationAction  } from "@s3ntiment/shared";
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
import { NillionPkpClient } from "./services/nildb.pkp.service.js";
import { NucCmd } from "@nillion/secretvaults";

export class PoolController {

    private lit: any;
    private litPoolKeys: any;
    private nillDB: any;


    constructor(lit: any, litPoolKeys: any, nillDB: any ) {
        this.lit = lit; 
        this.litPoolKeys = litPoolKeys;
        this.nillDB = nillDB
    }

    async create(body: any) {
        const contract = surveyStore.address;
        const { signature, userAddress, poolId, safeAddress } = body;

        if (poolId == undefined) return "missing poolId";
        if (safeAddress == undefined) return 'missing safeAddress';

        console.log("creating new pool")

        // Step 1: Create PKP + get all action CIDs in parallel
        const _decryptForOwnerAction = compactAction(getDecryptForOwnerAction(poolId, contract, safeAddress));
        const _decryptForRespondentAction = compactAction(getDecryptForRespondentAction(poolId, contract));
        const _ownerInvocationAction = compactAction(ownerInvocationAction(poolId, contract, safeAddress));
        const _userDelegationAction = compactAction(userDelegationAction(poolId, contract));

        const [pkpAddress, encryptCid, decryptOwnerCid, decryptMemberCid, getPubKeyCid, OwnerInvocationCid, UsereDelegationCid] = await Promise.all([
            this.lit.createPkp(),
            this.lit.getActionCid(encryptAction),
            this.lit.getActionCid(_decryptForOwnerAction),
            this.lit.getActionCid(_decryptForRespondentAction),
            this.lit.getActionCid(getPkpPublicKeyAction),
            this.lit.getActionCid(_ownerInvocationAction),
            this.lit.getActionCid(_userDelegationAction)
        ]);

        // Step 2: Register all actions in parallel (this returns hashed CIDs)
        const [encryptResult, decryptOwnerResult, decryptMemberResult, getPubKeyResult, getOwnerInvocationResult, getUserDelegationResult] = await Promise.all([
            this.lit.registerAction(encryptCid, 'encrypt'),
            this.lit.registerAction(decryptOwnerCid, `decrypt-owner-${poolId}`),
            this.lit.registerAction(decryptMemberCid, `decrypt-member-${poolId}`),
            this.lit.registerAction(getPubKeyCid, `get-public-key`),
            this.lit.registerAction(OwnerInvocationCid, `owner-invocation-${poolId}`),
            this.lit.registerAction(UsereDelegationCid, `user-delegation-${poolId}`)
        ]);


        // Step 4: Create group with PKP and actions pre-permitted
        // Note: Need to figure out pkp_id format - might be address or internal ID
        const { group_id: groupId } = await this.lit.createGroup(
            `s3ntiment-${poolId}`,
            '',
            [pkpAddress],  // pkp_ids_permitted - try with address first
            [encryptResult.hashedCid, decryptOwnerResult.hashedCid, decryptMemberResult.hashedCid, getPubKeyResult.hashedCid, getOwnerInvocationResult.hashedCid, getUserDelegationResult.hashedCid]  // cid_hashes_permitted
        );

        // Step 5: Create usage key
        const { usage_api_key } = await this.lit.createUsageKey({ executeInGroups: [groupId] });
        this.litPoolKeys.set(poolId, usage_api_key);

        const result = await this.lit.executeAction(poolId, getPkpPublicKeyAction, { pkpId: pkpAddress }, usage_api_key);
        const { publicKey } = result.response;
        const pkpDid = publicKeyToDidKey(publicKey);

        console.log('Pool setup verification:');
        console.log('- poolId:', poolId);
        console.log('- pkpAddress:', pkpAddress);
        console.log('- pkpDid:', pkpDid);
        console.log('- groupId:', groupId);

        return { pkpId: pkpAddress, pkpDid, groupId };
    }

    async update(body: any) {

        // but with what authority ???

        // can only be safe 
        // so shouldnt there be an action that allows for use of pkp to add an action? 

        // potentially add actions? // rotate usage key? 
    }

    async registerBuilder(body: any) {

        const {signature, userAddress, poolId, pkpId, pkpDid, safeAddress } = body;
        const usage_api_key = await this.litPoolKeys.get(poolId)
        const contract = surveyStore.address;

        const nillPkp = new NillionPkpClient(this.lit, poolId, safeAddress, contract)
        const builderRegistrationResult = await nillPkp.registerAsBuilder(signature, userAddress, pkpId, pkpDid, usage_api_key, `builder-${poolId}`);

        return { ok: true }
    }

    
}