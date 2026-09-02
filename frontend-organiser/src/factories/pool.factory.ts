import { Batch, Pool } from "@s3ntiment/shared";
import { IServices } from "../services/services";
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';

export const getPoolInfo = async (services:IServices, poolId: string) : Promise<Pool> => {

    const [safeAddress, createdAt ] = await services.viem.read(surveyStore.address as `0x${string}`, surveyStore.abi,"getPool", [poolId]);
    const _batches = await services.viem.read(surveyStore.address as `0x${string}`, surveyStore.abi,"getPoolBatches", [poolId]);
    const batches = _batches.map( (b:any ) => b.id)

    const abi = [{
        "inputs": [],
        "name": "getOwners",
        "outputs": [
            {
            "internalType": "address[]",
            "name": "",
            "type": "address[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
        }];

    const owners  = await services.viem.read(safeAddress, abi,"getOwners", []);

    return {
            id: poolId, 
            name: "",
            safeAddress, 
            batches,
            owners,
            readers: [],
            createdAt: Number(createdAt),
            // Partial config: a pool imported purely from on-chain data cannot
            // know its Lit PKP/group identity (pkpId/pkpDid/groupId are minted
            // at creation and returned only by POST /api/pools to the creating
            // organiser — never persisted on-chain). Only the Safe + network
            // identity are derivable here, so we populate exactly those. See
            // the type-drift consolidation PR decision record.
            config: {
                safe: safeAddress,
                chainId: import.meta.env.VITE_L2 == 'base' ? 8453 : 1,
                litNetwork: import.meta.env.VITE_LIT_NETWORK,
            }
    }
}