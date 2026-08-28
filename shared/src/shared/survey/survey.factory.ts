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

   const survey = await fetchSurveyAndParseCid(services, deployment, surveyId)

    let d: any;
    // Survey ownership is managed through a safe. Organiser is a signer to this safe 
    const userAddress = services.safe.getSignerAddress();
    const safeAddress = services.safe.getAddress();
    const signature = await services.safe.signMessage('Request capability to decrypt');
    const litApiKey = await withRetry(
      (signal) => fetchLitApiKey(backendUrl, userAddress, signature, survey.poolId, signal),
      {
        timeoutMs: 5_000,
        onRetry: (attempt, error) =>
          console.log(`[fetchLitApiKey] Attempt ${attempt}/3 failed: ${error.message}`),
      }
    );

    const decryptForOwnerAction = compactAction(getDecryptForOwnerAction(survey.poolId, deployment.address, safeAddress));
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


export const fetchAndDecryptSurveyWithRespondent = async (services: any, deployment: any, surveyId: string, poolConfig: PoolConfig, backendUrl: string) => {

    const [ipfsCid, poolId, createdAt] = await fetchSurvey(services, deployment, surveyId);
    const cid = extractCid(ipfsCid);
    const config: EncryptedConfig = JSON.parse(await services.ipfs.fetchFromPinata(cid));

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
    const data = await services.lit.decrypt(litApiKey, poolConfig.pkpId, config.encryptedForRespondent, services.account.getSignerAddress(), signature, decryptForRespondentAction);
    d = JSON.parse(data);
  
    return {
      id: surveyId,
      createdAt: Number(createdAt),
      ...d,
      ...config
    }
}
