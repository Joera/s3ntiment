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
//
// Refactor (Task 2): `authenticate` now RETURNS the derived leaf `S` private key
// (previously only a membership boolean) so the /account secure step can persist it
// locally and use it after the E→S rotate. It STILL swaps the acting signer to the
// derived leaf (updateSignerWithKey), matching its prior behaviour.

export interface AuthenticatedResult {
  /** Derived leaf `S` private key — the only place S is materialized for storage. */
  key: `0x${string}`;
  /** Derived leaf `S` address (the post-swap acting signer). */
  address: `0x${string}`;
  /** Whether the derived leaf is already a registered pool member. */
  participating: boolean;
}

export const authenticate = async (
  services: IServices,
  poolId: string
): Promise<AuthenticatedResult> => {
  await services.waap.login(base);
  const input = await services.waap.signMessage(
    `Sign in with your unlinkable account for respondent pool ${poolId}`
  );
  const key = (await services.oprf.getSecp256k1(input)) as `0x${string}`;
  await services.account.updateSignerWithKey(key);

  const address = services.account.getSignerAddress() as `0x${string}`;
  const participating = await hasParticipatingAccount(services, poolId);

  return { key, address, participating };
};

export const hasParticipatingAccount = async (services: IServices, poolId: string) : Promise<boolean> => {

    if(services.account.getSignerAddress() === '0x') return false;

    return await services.viem.read(
        surveyStore.address as `0x${string}`,
        surveyStore.abi,
        'isPoolMember',
        [poolId, services.account.getSignerAddress()]
    );

}
