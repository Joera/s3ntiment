import { generatePrivateKey } from 'viem/accounts';
import { IServices } from './services';
import {
  loadBootstrapKeyFromStorage,
  saveBootstrapKeyToStorage,
} from './state/storage.js';

// Random bootstrap stealth leaf — identity establishment at the survey ENTRY gate
// (Task 1b of RFC-deferred-identity-persistence).
//
// In the anchored-identity model a respondent with no anchor walks up with a card and
// is given a RANDOM bootstrap stealth leaf `E` (RFC §5.2). It is created from a
// CSPRNG private key (viem/accounts generatePrivateKey -> noble-secp256k1
// randomPrivateKey -> webcrypto crypto.getRandomValues), persisted to device-local
// storage immediately (RFC §7.1), and set as the smart-account signer. No anchor,
// no OPRF, no PRF for this random bootstrap leaf — the human-wallet (WaaP/OPRF) flow
// lives in humanWallet.factory.ts and is deferred to the post-survey persist step.
//
// Load-or-create: if a persisted key exists it is reused; otherwise one is generated
// and persisted before being fed to the account signer.
export const ensureBootstrapKey = async (
  services: IServices,
): Promise<`0x${string}`> => {
  const key = loadBootstrapKeyFromStorage() ?? createAndPersistBootstrapKey();

  await services.account.updateSignerWithKey(key);

  return services.account.getSignerAddress();
};

export function createAndPersistBootstrapKey(): `0x${string}` {
  const key = generatePrivateKey();
  saveBootstrapKeyToStorage(key);
  return key;
}
