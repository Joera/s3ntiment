import { withRetry } from '../helpers/retries.js';
import { compactAction, EncryptedConfig, fetchLitApiKey, getDecryptForOwnerAction, getDecryptForRespondentAction, PoolConfig } from '../index.js';


const extractCid = (result: unknown): string => {
  if (typeof result === 'string') {
    try { return JSON.parse(result).cid ?? result } catch { return result }
  }
  if (typeof result === 'object' && result !== null) {
    return (result as any).cid ?? (result as any).IpfsHash
  }
  return result as string
}

export const fetchSurvey = async (services: any, deployment: any, surveyId: string) => {

  return await services.viem.read(
      deployment.address as `0x{string}`, 
      deployment.abi,
      'getSurvey',
      [surveyId]
    );  
}

export const fetchSurveyAndParseCid = async (services: any, deployment: any, surveyId: string) : Promise<EncryptedConfig> => {

  const [ipfsCid, poolId, createdAt] = await fetchSurvey(services, deployment, surveyId);
  const cid = extractCid(ipfsCid)
  return JSON.parse(await services.ipfs.fetchFromPinata(cid));

}

export const fetchAndDecryptSurveyWithOwner = async (services: any, deployment: any, surveyId: string, poolConfig: PoolConfig, backendUrl: string) => {

   // Source the pool id from the on-chain fetchSurvey record (the second tuple
   // element), NOT from the parsed EncryptedConfig. The backend create() path
   // spreads the Survey object (`pool`, no `poolId`) into the uploaded config
   // — only update() writes poolId — so config.poolId is undefined for
   // create-path surveys and would otherwise bake `'undefined'` into the
   // owner-decrypt action code (same latent 403 class as the delegation bug,
   // audit survey-delegation-502). The chain value is authoritative for both
   // the usage-key fetch and the action code, mirroring the respondent path.
   const [ipfsCid, poolId, createdAt] = await fetchSurvey(services, deployment, surveyId);
   const cid = extractCid(ipfsCid)
   const survey = JSON.parse(await services.ipfs.fetchFromPinata(cid)) as EncryptedConfig;

    let d: any;
    // Survey ownership is managed through a safe. Organiser is a signer to this safe 
    const userAddress = services.safe.getSignerAddress();
    const safeAddress = services.safe.getAddress();
    const signature = await services.safe.signMessage('Request capability to decrypt');
    const litApiKey = await withRetry(
      (signal) => fetchLitApiKey(backendUrl, userAddress, signature, poolId, signal),
      {
        timeoutMs: 5_000,
        onRetry: (attempt, error) =>
          console.log(`[fetchLitApiKey] Attempt ${attempt}/3 failed: ${error.message}`),
      }
    );

    const decryptForOwnerAction = compactAction(getDecryptForOwnerAction(poolId, deployment.address, safeAddress));
    // let _cid = await services.lit.getActionCid(decryptForOwnerAction)
    // console.log(decryptForOwnerAction)

    const data = await services.lit.decrypt(litApiKey, poolConfig.pkpId, survey.encryptedForOwner, userAddress, signature, decryptForOwnerAction);
      d = JSON.parse(data);

    return {
        id: surveyId,
        createdAt: Number(survey.createdAt),
        ...d,
        ...survey
    }
}


export const fetchAndDecryptSurveyWithRespondent = async (services: any, deployment: any, surveyId: string, backendUrl: string) => {

    const [ipfsCid, poolId, createdAt] = await fetchSurvey(services, deployment, surveyId);
    const cid = extractCid(ipfsCid);
    const config: EncryptedConfig = JSON.parse(await services.ipfs.fetchFromPinata(cid));

    // A respondent has no other authoritative source of the pool's pkpId (the
    // creating organiser's one-shot POST /api/pools response is never visible to
    // them), so it must travel on the EncryptedConfig itself. The backend
    // persists `poolConfig` into this config at create()/update() time; derive
    // it here instead of requiring an (undefined) caller-supplied poolConfig.
    // Guard loudly for stale pre-fix surveys that carry no poolConfig, so the
    // cryptic `Cannot read properties of undefined (reading 'pkpId')` becomes a
    // clear error.
    if (!config.poolConfig?.pkpId) {
      throw new Error('MISSING_POOL_CONFIG: survey EncryptedConfig carries no poolConfig.pkpId');
    }

    // the account for pool membership is a simple account. 4337 with pimlico paymaster, only one signer 
    const signature = await services.account.signMessage('Request capability to decrypt');
    const litApiKey = await withRetry(
      (signal) => fetchLitApiKey(backendUrl, services.account.getSignerAddress(), signature, poolId, signal),
      {
        retries: 3,
        timeoutMs: 5_000,
        onRetry: (attempt, error) =>
          console.log(`[fetchLitApiKey] Attempt ${attempt}/3 failed: ${error.message}`),
      }
    );

    const decryptForRespondentAction = compactAction(getDecryptForRespondentAction(poolId, deployment.address));

    let d: any;
    const data = await services.lit.decrypt(litApiKey, config.poolConfig.pkpId, config.encryptedForRespondent, services.account.getSignerAddress(), signature, decryptForRespondentAction);
    d = JSON.parse(data);
  
    return {
      id: surveyId,
      createdAt: Number(createdAt),
      ...d,
      ...config
    }
}
