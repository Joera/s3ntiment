import { fallback, http } from "viem";
import type { Transport } from "viem";

export const getRPCUrl = (chainId: number, alchemyKey?: string): string | undefined => {

    switch (chainId) {
        case 1:
            return `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`;
        case 11155111:
            return "https://sepolia.infura.io/v3/5588b2f2645b47bf9d9df736ab328181";
        case 8453:
            return `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
        case 84532:
            return `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`;
        case 175188:
            return "https://yellowstone-rpc.litprotocol.com/";
        default:
            return undefined;
    }
};

// Chains whose primary RPC is Alchemy and which therefore get a drpc-first +
// alchemy-fallback transport (drpc URL composed from the per-chain drpc slug).
const DRPC_CHAIN_NAMES: Record<number, string> = {
    1: "ethereum",
    8453: "base",
    84532: "base-sepolia",
};

// Per-request timeout for the drpc entry so a hung provider fails over fast
// (mirrors the sibling repo's ~8s failover intent).
const DRPC_REQUEST_TIMEOUT_MS = 8000;

/**
 * Composes the drpc URL for a chain, e.g. `https://lb.drpc.live/base/<key>`.
 * Returns `undefined` for non-drpc-backed chains or when no key is supplied.
 */
export const getDRPCUrl = (chainId: number, drpcKey?: string): string | undefined => {
    const chainName = DRPC_CHAIN_NAMES[chainId];
    if (!chainName || !drpcKey) return undefined;
    return `https://lb.drpc.live/${chainName}/${drpcKey}`;
};

/**
 * True for the chains backed by Alchemy (Ethereum mainnet, Base, Base Sepolia)
 * that get a drpc-first + alchemy-fallback transport.
 */
export const isAlchemyBackedChain = (chainId: number): boolean => chainId in DRPC_CHAIN_NAMES;

/**
 * Ordered RPC URL list for a chain. Alchemy-backed chains yield `[drpc, alchemy]`;
 * every other chain (Infura sepolia, Yellowstone Lit, or no drpc key) yields the
 * single existing URL unchanged.
 */
export const getRPCUrls = (chainId: number, alchemyKey?: string, drpcKey?: string): string[] => {
    const alchemyUrl = getRPCUrl(chainId, alchemyKey);
    if (!alchemyUrl) return [];
    if (!isAlchemyBackedChain(chainId)) return [alchemyUrl];
    const drpcUrl = getDRPCUrl(chainId, drpcKey);
    return drpcUrl ? [drpcUrl, alchemyUrl] : [alchemyUrl];
};

/**
 * Builds a viem `fallback()` transport for the alchemy-backed chains: drpc first,
 * alchemy second, failing over from drpc to alchemy on error (viem fallback's
 * native behaviour). Drpc entry gets a short per-request timeout so a hung
 * provider fails over fast. Non-alchemy chains fall back to the lone single
 * transport, preserving the previous single-provider behaviour.
 */
export const buildRPCTransport = (
    chainId: number,
    alchemyKey?: string,
    drpcKey?: string,
): Transport | undefined => {
    const urls = getRPCUrls(chainId, alchemyKey, drpcKey);
    if (urls.length === 0) return undefined;

    const transports = urls.map((url, i) =>
        // First entry is drpc — give it the failover timeout.
        i === 0 ? http(url, { timeout: DRPC_REQUEST_TIMEOUT_MS }) : http(url),
    );

    if (transports.length === 1) return transports[0];
    // rank: false keeps ordering deterministic -> drpc always attempted first.
    return fallback(transports, { rank: false });
};

export const getScanApi = (chainId: number): string => {
    return `https://api.etherscan.io/v2/api?chainid=${chainId}`;
};
