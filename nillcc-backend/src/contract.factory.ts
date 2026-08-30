import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';


const client = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL) 
});


export async function getSurvey(owner: `0x${string}`, surveyId: string) {

    const result = await client.readContract({
    address: surveyStore.address as `0x${string}`,
    abi: surveyStore.abi,
    functionName: 'getSurvey',
    args: [surveyId]
  }) as [string, `0x${string}`, bigint]; 

  const [ipfsCid, surveyOwner, createdAt] = result;

 // let config = JSON.parse(await fromPinata(ipfsCid))

  return {
    ipfsCid,
    // didNil,
    // encryptedNilKey,
    surveyOwner,
    createdAt
  };
}
