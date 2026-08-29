import { recoverMessageAddress } from "viem";

import { CardData } from "@s3ntiment/shared";
import { cardMessageHash } from "./encoding.js";
import type { CardMessageContext } from "./encoding.js";


// The card message is now bound to pool/contract/chain (card-v2). To recover
// the signer over the exact digest the card was signed with, parseCardURL must
// be given the same CardMessageContext (poolId, storeAddress, chainId) the
// organiser used when printing the card. Without it the digest cannot be
// reconstructed, so owner recovery is skipped and `surveyOwner` is left unset.
export const parseCardURL = async (
    href: string,
    context?: CardMessageContext,
): Promise<CardData | null> => {

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

        let surveyOwner: string | undefined;

        if (context) {
            // Same digest the organiser signed and registerInPool verifies.
            const messageHash = cardMessageHash(context, decodedNullifier, decodedBatchId);

            console.log("encoded combo", messageHash)

            surveyOwner = await recoverMessageAddress({
                message: { raw: messageHash },
                signature: decodedSignature,
            });

            console.log("SURVEY OWNER", surveyOwner)
        }

        return {
            nullifier:   decodedNullifier,
            batchId:     decodedBatchId,
            signature:   decodedSignature,
            surveyOwner,
            surveyId:    decodedSurveyId,
            poolId:      context?.poolId,
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

    // isNullifierUsed is scoped per pool (card-v2): the read needs the poolId the
    // card belongs to. Prefer an explicit poolId; falls back to the poolId carried
    // on CardData (populated by parseCardURL from the given context) when present.
    async isUsed(services: any, surveyStore: any, poolId?: string): Promise<boolean> {

        const scopedPoolId = poolId ?? this.data.poolId;

        if (!scopedPoolId) {
            throw new Error('Cannot check card usage without a poolId');
        }

        return await services.viem.read(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            "isNullifierUsed",
            [scopedPoolId, this.data.nullifier, this.data.batchId]
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
