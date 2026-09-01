import { AuthenticationMethod, initWaaP } from "@human.tech/waap-sdk";
import type { SilkEthereumProviderInterface } from "@human.tech/waap-sdk";
import { createPublicClient, createWalletClient, custom, http, keccak256, toBytes, toHex } from "viem";
import type { Chain, WalletClient } from "viem";
import { TxOptions, TxResult } from "../../shared/evm/tx.types";

declare global {
    interface Window {
        waap: SilkEthereumProviderInterface;
    }
}

interface LoginResult {
    walletClient: WalletClient;
    address: `0x${string}`;
}

const initConfig = {
    config: {
        allowedSocials: [],
        authenticationMethods: ["email", "phone"] as AuthenticationMethod[],
        styles: { darkMode: false },
    },
    project: {
        name: "S3ntiment",
        logo: "",
    },
    environment: "staging" as const,
    walletConnectProjectId: "",
    referralCode: "",
};

export class WaapService {

    public walletClient: WalletClient | null = null;
    public publicClient: any = null;
    public address: `0x${string}` | null = null;

    private provider: SilkEthereumProviderInterface | null = null;
    private initPromise: Promise<void>;

    constructor() {
        this.initPromise = this.initWaap();
    }

    private async initWaap(): Promise<void> {
        // 2.3.0's initWaaP returns the provider directly; prefer it over the
        // window.waap global (which the SDK still sets for backwards compat).
        this.provider = await initWaaP(initConfig);
    }

    private get waap(): SilkEthereumProviderInterface {
        return this.provider ?? window.waap;
    }

    async createWallet(chain: Chain): Promise<WalletClient | null> {

        await this.initPromise;

        const waap = this.waap;

        if (!this.provider && !window.waap) {
            throw new Error("WaaP not initialized — provider is undefined");
        }

        const accounts: any = await waap.request({ method: "eth_requestAccounts" });

        // console.log("accounts", accounts);

        await waap.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${chain.id.toString(16)}` }],
        });

        if (accounts?.[0]) {
            this.address = accounts[0];
            this.publicClient = createPublicClient({
                chain,
                transport: http(),
            });
            this.walletClient = createWalletClient({
                account: this.address as `0x${string}`,
                chain,
                transport: custom(waap),
            });
        } else {
            console.warn("No accounts returned from WaaP — user may not be logged in yet");
        }

        console.log("signer address", this.address);

        return this.walletClient;
    }

    async login(chain: Chain): Promise<LoginResult> {

        await this.waap.login();
        await this.createWallet(chain);

        if (!this.address || !this.walletClient) {
            throw new Error("Failed to initialize wallet after login");
        }

        return {
            walletClient: this.walletClient,
            address: this.address,
        };
    }

    async logout(): Promise<void> {
        await this.waap.logout();
    }

    getWalletClient(): WalletClient | null {
        return this.walletClient;
    }

    getAddress(): `0x${string}` | null {
        return this.address;
    }

    async signMessage(message: string): Promise<`0x${string}`> {

        if (!this.walletClient || !this.address) {
            throw new Error("Not logged in");
        }

        const signature = await this.waap.request({
            method: "personal_sign",
            params: [toHex(message), this.address],
        });

        return signature as `0x${string}`;
    }

    async write(
        contractAddress: `0x${string}`,
        abi: any,
        functionName: string,
        args: any[],
        options: TxOptions = {}
    ): Promise<TxResult> {

        if (!this.walletClient || !this.address || !this.publicClient) {
            throw new Error("Not logged in");
        }

        const { waitForReceipt = false, confirmations = 1 } = options;

        const txHash = await this.walletClient.writeContract({
            address: contractAddress,
            abi,
            functionName,
            args,
            account: this.address,
            chain: null
        });

        const result: TxResult = { txHash };

        if (waitForReceipt) {
            result.receipt = await this.publicClient.waitForTransactionReceipt({
                hash: txHash,
                confirmations,
            });
        }

        return result;
    }

    async createNillDBSeed() {
        const signature = await this.signMessage('Connect to blind computer for private responses');
        return keccak256(toBytes(signature)).slice(2);
    }

}