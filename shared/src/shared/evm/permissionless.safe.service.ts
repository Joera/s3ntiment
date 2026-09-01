import { toSafeSmartAccount } from "permissionless/accounts";
import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, encodeFunctionData, http, keccak256, parseEther, toBytes, Transport } from "viem";
import type { Chain, PrivateKeyAccount } from "viem";
import { buildRPCTransport } from "./chains.factory.js";
import { TxOptions, TxResult } from "./tx.types.js";
import { extractDeployedAddress } from "./contract-address.factory.js";
import { privateKeyToAccount } from "viem/accounts";

export interface IPermissionlessSafeService {
    address: string;
    updateSignerWithKey: (key: `0x${string}`) => Promise<`0x${string}`>;
    connectToFreshSafe: (salt: string) => Promise<string>;
    connectToExistingSafe: (safeAddress: string) => Promise<string>;
    write: (address: string, abi: any, method: string, args: any[], options?: TxOptions) => Promise<TxResult>;
    writeRaw: (to: string, data: `0x${string}`, options?: TxOptions) => Promise<TxResult>;
    batchWrite: (calls: Array<{ address: string; abi: any; method: string; args: any[]; deploy?: boolean }>) => Promise<TxResult[]>;
    transfer: (to: string, amount: string) => Promise<string>;
    predictSafeAddress: (salt: string) => Promise<string>;
    isDeployed: (address?: string) => Promise<boolean>;
    addOwner: (address: `0x${string}`) => Promise<boolean>;
    signMessage: (message: string) => Promise<`0x${string}`>;

}

export class PermissionlessSafeService implements IPermissionlessSafeService {

    public address!: string;

    private chain: Chain;
    private signer: any;
    private smartAccount: any;
    private smartAccountClient: any;
    private publicClient: any;
    private pimlicoClient: any;
    private pimlicoKey: string;
    private entrypointV7: `0x${string}`;
    private txMutex: Promise<void> = Promise.resolve();

    constructor(chain: Chain, pimlicoKey: string, alchemyKey: string, entrypointV7: string, drpcKey: string) {

        this.chain = chain;
        this.pimlicoKey = pimlicoKey;
        this.entrypointV7 = entrypointV7 as `0x${string}`;

        this.publicClient = createPublicClient({
            chain,
            transport: buildRPCTransport(chain.id, alchemyKey, drpcKey) as any,
        });

        this.pimlicoClient = createPimlicoClient({
            transport: http(`https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${pimlicoKey}`) as Transport,
            entryPoint: {
                address: this.entrypointV7,
                version: "0.7",
            },
        });
    }

    async updateSignerWithKey(key: `0x${string}`): Promise<`0x${string}`> {
        this.signer = privateKeyToAccount(key);
        return this.signer.address;
    }

    getSigner(): PrivateKeyAccount  {
        return this.signer;
    }

    getSignerAddress() : string {
        return this.signer.address;
    }

    getAddress(): `0x${string}` | undefined {
        return this.smartAccount ? this.smartAccount.address: undefined;
    }

    async isDeployed(address?: string): Promise<boolean> {
        try {
            const checkAddress = address || this.address;

            if (!checkAddress) {
                console.log("No address to check");
                return false;
            }


            const code = await this.publicClient.getBytecode({
                address: checkAddress as `0x${string}`,
            });

            const deployed = code !== undefined && code !== "0x" && code.length > 2;
            // console.log("Safe deployment status:", deployed);
            return deployed;

        } catch (error: any) {
            console.error("Error checking deployment status:", error.message);
            return false;
        }
    }

    async connectToFreshSafe(salt: string): Promise<string> {

        const smartAccount = await toSafeSmartAccount({
            client: this.publicClient,
            owners: [this.signer],
            version: "1.4.1",
            saltNonce: BigInt(keccak256(toBytes(salt))),
            entryPoint: {
                address: this.entrypointV7,
                version: "0.7",
            },
        });

        return await this.setSafe(smartAccount);
    }

    async connectToExistingSafe(safeAddress: string): Promise<string> {

        let deployed = false;
        let attempts = 0;

        while (!deployed && attempts < 10) {
            deployed = await this.isDeployed(safeAddress);
            if (!deployed) {
                console.log(`Waiting for Safe deployment to be indexed... (${attempts + 1}/10)`);
                await new Promise(r => setTimeout(r, 2000));
                attempts++;
            }
        }

        if (!deployed) throw new Error(`Safe at ${safeAddress} not detected on-chain after waiting`);

        const smartAccount = await toSafeSmartAccount({
            client: this.publicClient,
            owners: [this.signer],
            version: "1.4.1",
            address: safeAddress as `0x${string}`,
            entryPoint: {
                address: this.entrypointV7,
                version: "0.7",
            },
        });

        return await this.setSafe(smartAccount);
    }

    async setSafe(smartAccount: any): Promise<string> {

        this.smartAccount = smartAccount;

        // const factoryArgs = await smartAccount.getFactoryArgs();

        this.smartAccountClient = createSmartAccountClient({
            account: smartAccount,
            chain: this.chain,
            bundlerTransport: http(`https://api.pimlico.io/v2/${this.chain.id}/rpc?apikey=${this.pimlicoKey}`),
            paymaster: this.pimlicoClient,
            userOperation: {
                estimateFeesPerGas: async () =>
                    (await this.pimlicoClient.getUserOperationGasPrice()).fast,
            },
        });

        this.address = smartAccount.address;
        return this.address;
    }

    async predictSafeAddress(salt: string): Promise<string> {

        const tempAccount = await toSafeSmartAccount({
            client: this.publicClient,
            owners: [this.signer],
            version: "1.4.1",
            saltNonce: BigInt(keccak256(toBytes(salt))),
            entryPoint: {
                address: this.entrypointV7,
                version: "0.7",
            },
        });

        return tempAccount.address;
    }

    async write(
        address: string,
        abi: any,
        method: string,
        args: any[],
        options: TxOptions = {}
    ): Promise<TxResult> {

        const { deploy = false, waitForReceipt = false, confirmations = 1, excludeAddress, nth } = options;

        console.log("🔧 write called:", { address, method, args: JSON.stringify(args) });

        const data = encodeFunctionData({ abi, functionName: method, args });
        const gasPrice = await this.pimlicoClient.getUserOperationGasPrice();

        const txHash = await this.smartAccountClient.sendTransaction({
            to: address as `0x${string}`,
            data,
            value: 0n,
            maxFeePerGas: gasPrice.fast.maxFeePerGas,
            maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        });

        console.log("✅ txHash:", txHash, "method:", method);

        const result: TxResult = { txHash };

        if (waitForReceipt || deploy) {
            result.receipt = await this.publicClient.waitForTransactionReceipt({
                hash: txHash as `0x${string}`,
                confirmations,
            });
        }

        if (deploy) {
            result.deployedAddress = await extractDeployedAddress(
                txHash,
                this.chain.id,
                excludeAddress || "",
                nth?.toString(),
            );
        }

        return result;
    }

    async writeRaw(to: string, data: `0x${string}`, options: TxOptions = {}): Promise<TxResult> {

        const { waitForReceipt = false, confirmations = 1 } = options;

        const gasPrice = await this.pimlicoClient.getUserOperationGasPrice();

        const txHash = await this.smartAccountClient.sendTransaction({
            to: to as `0x${string}`,
            data,
            value: 0n,
            maxFeePerGas: gasPrice.fast.maxFeePerGas,
            maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        });

        const result: TxResult = { txHash };

        if (waitForReceipt) {
            result.receipt = await this.publicClient.waitForTransactionReceipt({
                hash: txHash as `0x${string}`,
                confirmations,
            });
        }

        return result;
    }

    async batchWrite(calls: Array<{
        address: string;
        abi: any;
        method: string;
        args: any[];
        deploy?: boolean;
    }>): Promise<TxResult[]> {

        console.log("🔧 batchWrite: executing", calls.length, "transactions sequentially");

        const results: TxResult[] = [];

        for (const call of calls) {
            let result!: TxResult;

            await (this.txMutex = this.txMutex.then(async () => {
                console.log("📤 Executing:", call.method);
                result = await this.write(
                    call.address,
                    call.abi,
                    call.method,
                    call.args,
                    { deploy: call.deploy ?? false, waitForReceipt: true },
                );
                console.log("✅ Completed:", call.method, "->", result.txHash);
            }));

            results.push(result);
        }

        return results;
    }

    async transfer(to: string, amount: string): Promise<string> {

        const gasPrice = await this.pimlicoClient.getUserOperationGasPrice();

        const txHash = await this.smartAccountClient.sendTransaction({
            to: to as `0x${string}`,
            value: parseEther(amount),
            maxFeePerGas: gasPrice.fast.maxFeePerGas,
            maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
        });

        return txHash;
    }

    // signMessage uses EIP-191 — it prepends \x19Ethereum Signed Message:\n + length before hashing. 
    // That's fine for simple string messages and verifiable with viem's verifyMessage.
    // The signature comes from the signer as the safe cannot sign
    async signMessage (message: string) : Promise<`0x${string}`> {

        return await this.signer.signMessage({ message });
    }

    // The signature comes from the signer
    // but also verifiable via EIP-1271 red call isValidSignature() on the smart account address
    // Safe needs to be deployed!!! 
    async signTypedData(domain: any, types: any, message: any): Promise<`0x${string}`> {
        
        const signature = await this.signer.signTypedData({
            domain,
            types,
            message,
        });

        return signature;
    }

    async addOwner(address: `0x${string}`) {

        const result = await this.write(
            this.address,
            [
                {
                    name: 'addOwnerWithThreshold',
                    type: 'function',
                    stateMutability: 'nonpayable',
                    inputs: [
                        { name: 'owner', type: 'address' },
                        { name: '_threshold', type: 'uint256' }
                    ],
                    outputs: []
                }
            ],
            'addOwnerWithThreshold',
            [address, 1],
            { waitForReceipt: true }
        );

        console.log(result)

        return !!result.txHash;
    }
}

