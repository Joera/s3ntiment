import {
  Signer,
  Did
} from '@nillion/nuc';
import {
  NucCmd,
  SecretVaultBuilderClient,
  SecretVaultUserClient,
} from '@nillion/secretvaults';
import { PoolConfig, Survey, SurveyAnswer } from '../survey/types.js';
import { createUserDataObject } from '../survey/index.js';
import { Signature } from 'viem';
import { StringifyOptions } from 'node:querystring';


export class NillDBUserService {

    private nilDBNodes: string;
    signer!: Signer;
    userDidString!: string;
    user: any;
    builderDid: any;
 
    constructor(builderDid: any, nilDBNodes: string) { 
        this.builderDid = builderDid;
        this.nilDBNodes = nilDBNodes;
    }

    async init(seed: string) {
        this.signer = Signer.fromPrivateKey(seed);

        this.userDidString = (await this.signer.getDid()).didString;
        console.log('User DID:', this.userDidString);

        this.user = await SecretVaultUserClient.from({
            baseUrls: this.nilDBNodes.split(','),
            signer: this.signer,
            blindfold: {
                operation: 'sum',
            },
        });

    }

    async storeStandard(backendUrl: string, surveyId: string, poolId: string, userData: any, signature: Signature | `0x${string}`, signer: string) {
        return await fetch(`${backendUrl}/api/surveys/${surveyId}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                surveyId,
                poolId,
                userData,
                signature,
                signer
            })
        });
    }

    async storeOwned(uuid: string, survey: Survey, poolConfig: PoolConfig, answers: any, surveyId: string, delegation: string) {
    
   
        const userPrivateData = createUserDataObject(uuid, answers, survey, "");

        console.log("userPrivateData", userPrivateData)

        return await this.createData(survey, poolConfig, userPrivateData, delegation) 
    }

     async updateOwned(uuid: string, survey: Survey, poolConfig: PoolConfig, answers: any, surveyId: string, delegation:string, documentId: string) {
        
        const userPrivateData = createUserDataObject(uuid, answers, survey, "");
        
        await this.user.deleteData({
            collection: surveyId,
            data: [userPrivateData],
            document: documentId
        });

        return await this.createData(survey, poolConfig, userPrivateData, delegation) 
    } 
        

    async createData(survey: Survey, poolConfig: PoolConfig, userPrivateData: any, delegation: string) {

        try { 
            // PKP-signed tokens grant users write permission. The SDK expects them as invocations (ready-to-use) rather than delegation (requires user to co-sign).
            const uploadResults = await this.user.createData(
                {
                    owner: this.userDidString,
                    acl: {
                        grantee: poolConfig!.pkpDid, 
                        read: true,
                        write: false,
                        execute: true,
                    },
                    collection: survey.id,
                    data: [userPrivateData],
                },
                { auth: { delegation } }
            );

            console.log('success', uploadResults);

            return { 
                ok: true,  
                response: uploadResults
            }

        } catch (e: any) {
            console.log('error', JSON.stringify(e, null, 2));
            console.log('error message', e?.message);
            console.log('error cause', e?.cause);
            if (Array.isArray(e)) {
                e.forEach((n, i) => console.log(`node ${i}`, JSON.stringify(n, null, 2)));
            }
            throw e;
        }
    }

 

    async getUserDelegationToken(signature: string, surveyId: string, poolConfig: PoolConfig, backendUrl: string) {
        console.log('requesting delegation for DID:', this.userDidString);

        try {
            const response = await fetch(`${backendUrl}/api/surveys/${surveyId}/delegation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    didString: this.userDidString,
                    surveyId,
                    signature, 
                    poolConfig
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const dtoken: any = await response.json();
            console.log(typeof dtoken.delegation);
            return dtoken.delegation;
        
        } catch (error) {
            console.error("Failed to get delegation token:", error);
            throw error;
        }
    }

    async getUserSurveyAnswers(surveyId: string) {
        try {
            const dataRefs = await this.user.listDataReferences();

            const surveyDataRefs: any[] = dataRefs.data.filter((ref: any) => 
                ref.collection === surveyId
            );

            if (surveyDataRefs.length === 0) {
                console.log('No previous survey data found');
                return null;
            }

            console.log(surveyDataRefs[0]);

            const surveyData = await this.user.readData({
                collection: surveyId,
                document: surveyDataRefs[0].document
            });

            if (surveyData.data.surveyId === surveyId) {
                return surveyData.data;
            }

            return null;
        } catch (error) {
            console.error('Error fetching user survey answers:', error);
            return null;
        }
    }

    async testDirectWrite(survey: Survey, poolConfig: PoolConfig, data: any, invocations: Record<string, string>) {
        const nodes = [
            { url: 'https://nildb-stg-n1.nillion.network', did: 'did:key:zQ3shcivRHjnU2ASFFTFC3Y1uoLAqEhTTqMKHGUundhcywNy7' },
        ];

        const node = nodes[0];
        const token = invocations[node.did];
        
        const body = {
            owner: this.userDidString,
            collection: survey.id,
            data: [data],
            acl: {
                grantee: poolConfig!.pkpDid,
                read: true,
                write: false,
                execute: true
            }
        };

        console.log('Direct POST to:', `${node.url}/v1/data/owned`);
        console.log('Token:', token);
        console.log('Body:', JSON.stringify(body, null, 2));
        
        const response = await fetch(`${node.url}/v1/data/owned`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });

        const text = await response.text();
        console.log('Response:', response.status, response.statusText);
        console.log('Response body:', text);
        
        return { status: response.status, body: text };
    }
}