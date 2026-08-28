import { combineShares, compactAction, PoolConfig, ownerInvocationAction, QuestionGroup, Survey, tallyResults, userDelegationAction } from "@s3ntiment/shared";

// Backend service that uses PKP-signed invocations
export class NillionPkpClient {

    lit: any;
    poolId: string;
    safeAddress: string;
    contract: string;

    constructor(lit: any, poolId: string, safeAddress: string, contract: string) {
        this.lit = lit;
        this.poolId = poolId;
        this.safeAddress = safeAddress;
        this.contract = contract;
    }

    private nodes = [
        { url: 'https://nildb-stg-n1.nillion.network', did: 'did:key:zQ3shcivRHjnU2ASFFTFC3Y1uoLAqEhTTqMKHGUundhcywNy7' },
        { url: 'https://nildb-stg-n2.nillion.network', did: 'did:key:zQ3shTJe9zjBPfhcykspLMjLpCwcBHqowGcpmvuY3tiR3jvHD' },
        { url: 'https://nildb-stg-n3.nillion.network', did: 'did:key:zQ3sheuiqFDDhsiMcEdfHcGFbqbfAA1ttqDsSaLaUTk9LQfpe' },
    ];

    async registerAsBuilder(signature: string, userAddress: string, pkpId: string, pkpDid: string, usageKey: string, name: string = 'S3ntiment PKP') {
        const results: Record<string, any> = {};

        const action = compactAction(ownerInvocationAction(this.poolId, this.contract, this.safeAddress))
        
        for (const node of this.nodes) {
            const result  = await this.lit.executeAction(
                this.poolId,
                action,
                { 
                    signature,
                    userAddress,
                    pkpId, 
                    pkpDid, 
                    nodeDid: node.did, 
                    command: '/nil/db/builders/create'
                },
                usageKey
            );

            let { invocation } = result.response;


            if (invocation == undefined ) {
                console.log('invocation failed', result)
                return;
            }

            const response = await fetch(`${node.url}/v1/builders/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${invocation}`
                },
                body: JSON.stringify({ did: pkpDid, name }) 
            });
            
            results[node.did] = response.status;
        }
        
        return results;
    }

    async createCollection(signature: string, userAddress: string, pkpId: string, pkpDid: string, usageKey: string, collectionData: any) {
        const results: Record<string, any> = {};

        // console.log('Creating collection with data:', JSON.stringify(collectionData, null, 2));

        for (const node of this.nodes) {
            
            const result = await this.lit.executeAction(
                this.poolId,
                compactAction(ownerInvocationAction(this.poolId, this.contract, this.safeAddress)),
                { signature, userAddress, pkpId, pkpDid, nodeDid: node.did, command: '/nil/db/collections/create' },
                usageKey
            );

            const invocation = result?.invocation || result?.response?.invocation;

            if (invocation == undefined ) {
                console.log('invocation failed', result)
                return;
            }
            
            const response = await fetch(`${node.url}/v1/collections`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${invocation}`
                },
                body: JSON.stringify(collectionData)
            });

         //   console.log("COLLECTION", response)
            
            const text = await response.text();
         //   console.log('Create collection response:', response.status, text);

            // Handle empty response
            const data = text ? JSON.parse(text) : { status: response.status };
            results[node.did] = { status: response.status, data };
        }
        
        return results;
    }

    async createQuery(signature: string, userAddress: string, pkpId: string, pkpDid: string, usageKey: string, queryData: any) {
        const results: Record<string, any> = {};

        for (const node of this.nodes) {
            const result = await this.lit.executeAction(
                this.poolId,
                compactAction(ownerInvocationAction(this.poolId, this.contract, this.safeAddress)),
                { signature, userAddress, pkpId, pkpDid, nodeDid: node.did, command: '/nil/db/queries/create' },
                usageKey
            );

            const invocation = result?.invocation || result?.response?.invocation;

            if (!invocation) {
                console.log('invocation failed', result);
                return;
            }

            const response = await fetch(`${node.url}/v1/queries`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${invocation}`
                },
                body: JSON.stringify(queryData)
            });

            const text = await response.text();
            const data = text ? JSON.parse(text) : { status: response.status };
            results[node.did] = { status: response.status, data };
            console.log(`Create query on ${node.url}:`, response.status);
        }

        return results;
    }

    /**
     * Generate a delegation token for user data writes.
     * 
     * This creates a SINGLE delegation (not per-node tokens).
     * The SDK will use this delegation to build per-node invocations.
     * 
     * Token structure (delegation):
     * - iss/sub: PKP DID (builder granting permission)
     * - aud: User DID (receiving permission)
     * - cmd: '/nil/db/data/create'
     * - pol: [] (policy - empty means no restrictions)
     * 
     * Frontend usage:
     *   await sdk.createData(body, { auth: { delegation } })
     * 
     * NOT:
     *   await sdk.createData(body, { auth: { invocations: {...} } })
     */
    async getUserWriteDelegation(signature: string, userAddress: string, surveyId: string, userDid: string, poolId: string, usageKey: string, pkpId: string, pkpDid: string) {

        const params = {
            signature,
            userAddress,
            pkpId,
            pkpDid,
            userDid,
            collectionId: surveyId
        };

        const code = compactAction(userDelegationAction(this.poolId, this.contract));

        console.log(code);

        const result = await this.lit.executeAction(
            poolId,
            code,
            params,
            usageKey
        );
        
        return { delegation: result.response.delegation };
    }

    // async computeResults(surveyId: string, groups: QuestionGroup[], signature: string, userAddress: string, pkpId: string, pkpDid: string, usageKey: string) {


   
    // }

    async runQuery(auth: any, queryIds: string[], poolConfig: PoolConfig, usageKey: string) {
        const runIds: Record<string, string> = {};

        for (const node of this.nodes) {

            const args = { 
                ...auth,
                ...poolConfig, 
                nodeDid: node.did, 
                command: '/nil/db/queries/execute' 
            }

            const result = await this.lit.executeAction(
                this.poolId,
                compactAction(ownerInvocationAction(this.poolId, this.contract, this.safeAddress)),
                args,
                usageKey
            );

            const invocation = result?.invocation || result?.response?.invocation;
            const response = await fetch(`${node.url}/v1/queries/run`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${invocation}`
                },
                body: JSON.stringify({ _id: queryIds![0], variables: {} })
            });

            const data: any = await response.json();
            runIds[node.did] = data.data;  // runId
            console.log(`Run query on ${node.url}:`, response.status, 'runId:', data.data);
        }

        return runIds;
    }

    async readQueryResults(auth: any, surveyConfig: PoolConfig, usageKey: string, runIds: Record<string, string>) {
        const nodeResults: any[] = [];

        for (const node of this.nodes) {
            const runId = runIds[node.did];

            const result = await this.lit.executeAction(
                this.poolId,
                compactAction(ownerInvocationAction(this.poolId, this.contract, this.safeAddress)),
                { 
                    ...auth, 
                    ...surveyConfig, 
                    nodeDid: node.did, 
                    command: '/nil/db/queries/read' 
                },
                usageKey
            );

            const invocation = result?.invocation || result?.response?.invocation;

            const response = await fetch(`${node.url}/v1/queries/run/${runId}`, {
                headers: { 'Authorization': `Bearer ${invocation}` }
            });

            const data: any = await response.json();
            console.log(`Query result from ${node.url}:`, data.data?.status);
            
            if (data.data?.status === 'complete') {
                nodeResults.push(data.data.result);
            }

            console.log(`Node ${node.url} raw result:`, JSON.stringify(data.data?.result, null, 2));
        }

        console.log(nodeResults)

        return combineShares(nodeResults);
    }

        // async getCollection(pkpId: string, pkpDid: string, usageKey: string, collectionId: string) {
    //     const node = this.nodes[0];
        
    //     const result = await this.lit.executeAction(
    //         'get-collection',
    //         ownerInvocationAction(this.poolId, this.contract, this.safeAddress),
    //         { pkpId, pkpDid, nodeDid: node.did, command: '/nil/db/collections/read' },
    //         usageKey
    //     );
        
    //     const invocation = result?.response?.invocation;  
        
    //     const response = await fetch(`${node.url}/v1/collections/${collectionId}`, {
    //         headers: { 'Authorization': `Bearer ${invocation}` }
    //     });
        
    //     console.log(`Collection ${collectionId} exists?`, response.status);
    //     const data = response.ok ? await response.json() : null;
    //     return { status: response.status, data };
    // }

    // async listCollections(pkpId: string, pkpDid: string, usageKey: string) {
    //     const node = this.nodes[0];
        
    //     const result = await this.lit.executeAction(
    //         'list-collections',
    //         ownerInvocationAction(this.poolId, this.contract, this.safeAddress),
    //         { pkpId, pkpDid, nodeDid: node.did, command: '/nil/db/collections/read' },
    //         usageKey
    //     );
        
    //     const invocation = result?.response?.invocation;
        
    //     const response = await fetch(`${node.url}/v1/collections`, {
    //         method: 'GET',
    //         headers: {
    //             'Authorization': `Bearer ${invocation}`
    //         }
    //     });
        
    //     const data = await response.json();
    //     console.log('Collections for this builder:', JSON.stringify(data, null, 2));
    //     return data;
    // }

}