import { getAddress, http, keccak256, toBytes } from "viem";
import { base } from "viem/chains";
import { Batch } from "@s3ntiment/shared";

import { isCid } from "../utils/regex";
import { createBatchWallet, createZipFile, generateCardSecrets, uploadToPinata } from "./invitation.factory";
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' assert { type: 'json' }
import { toSafeSmartAccount } from "permissionless/accounts";


export const createBatch = async (services: any, batch: Batch, poolId: string, surveyId: string) => {

    console.log("creating batch")

    const { batchId, batchAccount } = await createBatchWallet(services);
    batch.id = getAddress(batchId);
    batch.survey = surveyId;
    batch.pool = poolId;
    // card-v2: cards are signed bound to the survey-store deployment on this
    // chain (base) — must match the on-chain digest (address(this), block.chainid).
    batch.cards = await generateCardSecrets(batchAccount, batch, surveyStore.address, BigInt(base.id));
    batch.cards = await uploadToPinata(services, batch.cards);
    return batch;
}

// export const createInvitations = async (batch: Batch) => {

//     if (batch.cards == undefined) return;

//     if (batch.medium == 'zip-file') {

//         await createZipFile(batch.cards, batch.survey)
//     }

//     return batch;
// }


export const registerBatch = async (services: any, batch: Batch) => {

    const args = [
        batch.pool,
        batch.id,
    ]

    const options = {
        waitForReceipt: true
    }

    return await services.account.write(surveyStore.address, surveyStore.abi, "registerBatch", args, options);
}

// export const deploySafe = async (services: any, salt: string): Promise<string> => {
    
//     const safeAddress = await services.safe.predictSafeAddress(salt);

//     if (await services.safe.isDeployed(safeAddress)) {
//         return safeAddress;
//     }
    
//     const tempAccount = await toSafeSmartAccount({
//         client: services.safe.publicClient,
//         owners: [services.safe.signer],
//         version: "1.4.1",
//         saltNonce: BigInt(keccak256(toBytes(salt))),
//         entryPoint: { address: "0x0000000071727De22E5E9d8BAf0edAc6f37da032", version: "0.7" },
//     });

//     // Get factory info directly from the account — no network calls needed
//     const { factory, factoryData } = await tempAccount.getFactoryArgs();

//     if (!factory || !factoryData) {
//         throw new Error("No factory data — Safe may already be deployed");
//     }

//     await services.safe.writeRaw(factory, factoryData, true);

//     return safeAddress;
// }