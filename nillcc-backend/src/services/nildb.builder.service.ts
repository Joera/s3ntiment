import {
    Builder,
    Signer,
    Did,
    Codec,
    Command
} from '@nillion/nuc';

import {
    SecretVaultBuilderClient,
    NucCmd
} from '@nillion/secretvaults';
import { QuestionGroup, tallyResults } from "@s3ntiment/shared";
import { decrypt, encrypt } from "eciesjs";


const config = {
    BUILDER_KEY: process.env.VITE_NIL_BUILDER_PRIVATE_KEY || "",
    NILDB_NODES: (process.env.VITE_NILDB_NODES || "").split(','),
};

export class NilDBBuilderService {

    builderKey: string;
    builderSigner: Signer;
    builderDid: Did | undefined;
    builderClient: any;

    constructor() {
        this.builderKey = config.BUILDER_KEY;
        this.builderSigner = Signer.fromPrivateKey(this.builderKey);
    }

    async initBuilder() {
        this.builderDid = await this.builderSigner.getDid();
        console.log('Builder DID:', this.builderDid.didString);

        this.builderClient = await SecretVaultBuilderClient.from({
            signer: this.builderSigner,
            dbs: config.NILDB_NODES,
            blindfold: { operation: "sum" },
        });

        console.log('Builder client initialized');
    }

    async getBuilderProfile() {
        const profile = await this.builderClient.readProfile();
        console.log('Full profile:', JSON.stringify(profile, null, 2));
        return profile;
    }

    async getCollectionInfo(collectionId: string) {
        try {
            const result = await this.builderClient.readCollection(collectionId);
            console.log('Collection info:', JSON.stringify(result, null, 2));
            return result;
        } catch (e: any) {
            console.log('Error reading collection:', e?.message);
            return null;
        }
    }

    async createSurveyCollection(id: string, rawSchema: any) {

        console.log("raw schema", rawSchema)
        try {
            const result = await this.builderClient.createCollection({
                _id: id,
                name: rawSchema.name,
                type: rawSchema.type,
                schema: rawSchema.schema,
            });
            console.log("collection created", result);
            return id;
        } catch (e: any) {
            throw e;
        }
    }

    async submitResponseForUser(surveyId: string, userData: any) {
        const existingDocIds = await this.exists(surveyId, userData.signer);
        console.log("Existing", existingDocIds);

        if (existingDocIds && existingDocIds.length > 0) {
            for (const id of existingDocIds) {
                const d = await this.builderClient.deleteData({
                    collection: surveyId,
                    filter: { _id: id },
                });
                console.log("deleted", d);
            }
        }

        try {
            return await this.builderClient.createStandardData({
                collection: surveyId,
                data: [userData]
            });
        } catch (e: any) {
            if (Array.isArray(e)) {
                e.forEach((err, i) => {
                    console.error(`Node ${i}:`, JSON.stringify(err, null, 2));
                    console.error('Cause:', err.cause);
                });
            } else {
                console.error('Full error:', JSON.stringify(e, null, 2));
            }
            throw e;
        }
    }

    async testDelegationFormat() {
        // Create a test delegation
        const delegation = await Builder.delegation()
            .command(NucCmd.nil.db.data.create as Command)
            .subject(this.builderDid!)
            .audience(this.builderDid!) // self for testing
            .expiresIn(30_000)
            .signAndSerialize(this.builderSigner);

        console.log('Raw delegation string:', delegation);
        console.log('Delegation length:', delegation.length);
        
        // Try to decode it
        try {
            const decoded = Codec._unsafeDecodeBase64Url(delegation);
            console.log('Decoded delegation:', JSON.stringify(decoded, null, 2));
        } catch (e) {
            console.log('Decode error:', e);
        }
        
        // Also try base64 decode manually
        const parts = delegation.split('.');
        console.log('Parts count:', parts.length);
        for (let i = 0; i < parts.length; i++) {
            try {
                const decoded = JSON.parse(Buffer.from(parts[i], 'base64url').toString());
                console.log(`Part ${i}:`, JSON.stringify(decoded, null, 2));
            } catch (e) {
                console.log(`Part ${i}: (not JSON)`, parts[i].substring(0, 50));
            }
        }
    }

    async delegateCollectionToPkp(collectionId: string, pkpDid: string) {
        const pkpDidParsed = Did.parse(pkpDid);
        
        // Builder delegates create permission to PKP
        const delegation = await Builder.delegation()
            .command(`/nil/db/${collectionId}/data/create` as Command)
            .subject(this.builderDid!)
            .audience(pkpDidParsed)
            .expiresIn(1 * 28 * 24 * 60 * 60 * 1000) // 1000 years
            .signAndSerialize(this.builderSigner);

        console.log('Delegation to PKP created:', delegation.substring(0, 50) + '...');
        
        return delegation;
    }

    // User delegations still need to be created manually
    // async getUserWriteDelegation(didString: string, surveyId: string) {
    //     console.log('builderSigner:', this.builderSigner ? 'present' : 'MISSING');
    //     console.log('collection', surveyId);

    //     const userDid = Did.parse(didString);
    //     console.log('issuing delegation to DID:', userDid);

    //     const delegation = await Builder.delegation()
    //         .command(NucCmd.nil.db.data.create as Command)
    //         .subject(this.builderDid!)
    //         .audience(userDid)
    //         .expiresIn(3600_000)
    //         .signAndSerialize(this.builderSigner);

    //     return delegation;
    // }

    async getOwnerReadDelegation(surveyOwnerDid: Did, surveyId: string) {
        return await Builder.delegation()
            .audience(surveyOwnerDid)
            .subject(this.builderDid!)
            .command(NucCmd.nil.db.data.read as Command)
            .policy([
                ["==", ".args.collection", surveyId]
            ])
            .expiresIn(365 * 24 * 3600_000)
            .signAndSerialize(this.builderSigner);
    }

    async findSurveyResults(surveyId: string, groups: QuestionGroup[], signature: any) {
        await new Promise(r => setTimeout(r, 5000));

        try {
            const rawResults = await this.builderClient.findData({
                collection: surveyId,
                filter: {}
            });

            console.log(rawResults);

            try {
                const talliedResults = tallyResults(rawResults.data, groups);
                return talliedResults;
            } catch (error) {
                console.log("error tallying", error);
            }
        } catch (error) {
            console.log("error", JSON.stringify(error));
            return { result: false };
        }
    }

    async exists(surveyId: string, signer: string) {
        const rawResults = await this.builderClient.findData({
            collection: surveyId,
            filter: { signer: signer }
        });

        return rawResults.data[0] ? rawResults.data.map((r: any) => r._id) : false;
    }

    async getResponseById(surveyId: string, docId: string) {
        const rawResults = await this.builderClient.findData({
            collection: surveyId,
            filter: { _id: docId }
        });

        return rawResults.data[0];
    }

    encryptToBuilder(data: any): string {
        const message = Buffer.from(JSON.stringify(data));
        const pubKeyBytes = (this.builderDid as any).publicKeyBytes;
        const pubKeyHex = Buffer.from(pubKeyBytes).toString('hex');
        const encrypted = encrypt(pubKeyHex, message);
        return Buffer.from(encrypted).toString('base64');
    }

    decryptFromBuilder(encryptedBase64: string): any {
        const encrypted = new Uint8Array(Buffer.from(encryptedBase64, 'base64'));
        const decrypted = decrypt(this.builderKey, encrypted);
        return JSON.parse(Buffer.from(decrypted).toString());
    }

    async getNodeInfo() {
        console.log('Builder client nodes:', this.builderClient.nodes);
        // or
        for (const node of this.builderClient.nodes) {
            console.log('Node:', node.id?.didString, node.baseUrl);
        }
    }
}