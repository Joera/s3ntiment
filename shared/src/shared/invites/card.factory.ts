import { recoverMessageAddress } from "viem";

import { CardData } from "@s3ntiment/shared";
import { cardMessageHash } from "./encoding.js";


export const parseCardURL = async (href: string): Promise<CardData | null> => {

    try {
        const params = new URL(href).searchParams;

        const nullifier  = params.get('n');
        const batchId    = params.get('b');

        const signature  = params.get('sig');
        const surveyId   = params.get('s');

        if (!nullifier || !batchId || !signature || !surveyId) {
            console.error('Missing required card parameters');
            return null;
        }

        const decodedNullifier  = decodeURIComponent(nullifier);
        const decodedBatchId    = decodeURIComponent(batchId) as `0x${string}`;
        const decodedSignature  = decodeURIComponent(signature) as `0x${string}`;
        const decodedSurveyId   = decodeURIComponent(surveyId);

        const messageHash = cardMessageHash(decodedNullifier, decodedBatchId);

        console.log("encoded combo", messageHash)

        const surveyOwner = await recoverMessageAddress({
            message: { raw: messageHash },
            signature: decodedSignature,
        });

        console.log("SURVEY OWNER", surveyOwner)

        return {
            nullifier:   decodedNullifier,
            batchId:     decodedBatchId,
            signature:   decodedSignature,
            surveyOwner,            
            surveyId:    decodedSurveyId,
        };

    } catch (error) {
        console.error('Error parsing card URL:', error);
        return null;
    }
};

export class Card {

    public data: CardData;

    constructor(data: CardData) {
        this.data = data;
    }

    async isUsed(services: any, surveyStore: any): Promise<boolean> {

        return await services.viem.read(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            "isNullifierUsed",
            [this.data.nullifier, this.data.batchId]
        );
    }

    async register(services: any, surveyStore: any, poolId: string) { // should be called register

        return await services.account.write(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            'registerInPool',
            [poolId, this.data.nullifier, this.data.batchId, this.data.signature],
            { waitForReceipt: true, confirmations: 2 }
        );
        
        // await waitUntilRegistered(poolId, this.data.nullifier) // poll contract until it returns true

    }

    get surveyId() { return this.data.surveyId; }
    get nullifier() { return this.data.nullifier; }
    get batchId()   { return this.data.batchId; }
}