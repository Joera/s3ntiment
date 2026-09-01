import { createPublicClient, recoverMessageAddress } from "viem";
import type { Chain } from "viem";
import { buildRPCTransport } from "./chains.factory.js";

export class ViemService {

    public publicClient: any;
    private chain: Chain;

    constructor(chain: Chain, alchemyKey: string, drpcKey: string) {
        this.chain = chain;
        this.publicClient = createPublicClient({
            chain,
            transport: buildRPCTransport(chain.id, alchemyKey, drpcKey) as any,
        });
    }

    async read(address: `0x${string}`, abi: any, functionName: string, args: any[] = []): Promise<any> {
        return await this.publicClient.readContract({
            address,
            abi,
            functionName,
            args,
        });
    }

     async verifyMessage(msg: string, signature: `0x${string}`): Promise<`0x${string}`> {
        const address = await recoverMessageAddress({
            message: msg,
            signature,
        });

        return address;
    }
}