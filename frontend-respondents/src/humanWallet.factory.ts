import { base } from "viem/chains";
import { IServices } from "./services"
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { fetchSurvey } from "../../shared/src/shared";

// Human-wallet identity flow — EXTRACTED (Task 1a of RFC-deferred-identity-persistence).
//
// This is the full "human wallet" flow: WaaP login -> signMessage -> OPRF blind-sign
// derive -> swap the smart-account signer via updateSignerWithKey. It is the durable,
// anchor-stealth pairing for the LATER post-survey persist route — NOT called at the
// survey entry gate. Entry now bootstraps a random stealth leaf instead
// (see bootstrap.factory.ts ensureBootstrapKey).
//
// The persist flow (later task) re-establishes a durable anchor identity from this
// factory and rotates records E -> S. It is deliberately NOT invoked at entry.

export const authenticate = async (services: IServices, poolId: string) : Promise<boolean>=> {
         
    await services.waap.login(base);
    const input = await services.waap.signMessage(`Sign in with your unlinkable account for respondent pool ${poolId}`); // make into factory // set splash ? 
    const key = await services.oprf.getSecp256k1(input);
    await services.account.updateSignerWithKey(key);

    return await hasParticipatingAccount(services, poolId)
}

export const hasParticipatingAccount = async (services: IServices, poolId: string) : Promise<boolean> => {

    if(services.account.getSignerAddress() === '0x') return false;

    return await services.viem.read(
        surveyStore.address as `0x${string}`,
        surveyStore.abi,
        'isPoolMember',
        [poolId, services.account.getSignerAddress()]
    );

}
