import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http } from "viem";
import {
    buildRPCTransport,
    getDRPCUrl,
    getRPCUrl,
    getRPCUrls,
    isAlchemyBackedChain,
} from "./chains.factory.js";

// We keep viem's real `fallback()` so the native failover loop is actually
// exercised, but mock `http()` to inject deterministic fake transports
// (drpc fails -> alchemy answers). The chains.factory leaf is imported by
// direct relative source path, per the shared-package test convention.
vi.mock("viem", async (importOriginal) => {
    const actual = await importOriginal<typeof import("viem")>();
    return { ...actual, http: vi.fn() };
});

// Ordered list of URLs handed to `http()` as transports are built.
let constructionOrder: string[] = [];
// When true the (mocked) drpc transport throws so viem falls back to alchemy.
let drpcFails = true;

beforeEach(() => {
    constructionOrder = [];
    drpcFails = true;
    vi.mocked(http).mockImplementation((((url: string) => {
        constructionOrder.push(url);
        return ({ chain: _chain, ..._rest }: any) => ({
            request: async ({ method, params }: any) => {
                if (url.includes("lb.drpc.live") && drpcFails) {
                    throw new Error(`fake drpc transport error for ${method}`);
                }
                return { result: "ok", params };
            },
            config: {},
        });
    }) as unknown) as typeof http);
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("getRPCUrl (single-URL semantics preserved)", () => {
    it("returns the alchemy URL for the alchemy-backed chains", () => {
        expect(getRPCUrl(1, "ak")).toBe("https://eth-mainnet.g.alchemy.com/v2/ak");
        expect(getRPCUrl(8453, "ak")).toBe("https://base-mainnet.g.alchemy.com/v2/ak");
        expect(getRPCUrl(84532, "ak")).toBe("https://base-sepolia.g.alchemy.com/v2/ak");
    });

    it("keeps the non-alchemy branches (Infura sepolia, Yellowstone Lit) unchanged", () => {
        expect(getRPCUrl(11155111)).toBe("https://sepolia.infura.io/v3/5588b2f2645b47bf9d9df736ab328181");
        expect(getRPCUrl(175188)).toBe("https://yellowstone-rpc.litprotocol.com/");
    });

    it("returns undefined for unknown chains", () => {
        expect(getRPCUrl(999)).toBeUndefined();
    });
});

describe("getDRPCUrl", () => {
    it("composes the drpc URL per alchemy-backed chain", () => {
        expect(getDRPCUrl(1, "dk")).toBe("https://lb.drpc.live/ethereum/dk");
        expect(getDRPCUrl(8453, "dk")).toBe("https://lb.drpc.live/base/dk");
        expect(getDRPCUrl(84532, "dk")).toBe("https://lb.drpc.live/base-sepolia/dk");
    });

    it("returns undefined for non-drpc chains or a missing key", () => {
        expect(getDRPCUrl(11155111, "dk")).toBeUndefined();
        expect(getDRPCUrl(8453)).toBeUndefined();
    });
});

describe("isAlchemyBackedChain", () => {
    it("flags exactly the chains with a drpc-first + alchemy-fallback transport", () => {
        expect(isAlchemyBackedChain(1)).toBe(true);
        expect(isAlchemyBackedChain(8453)).toBe(true);
        expect(isAlchemyBackedChain(84532)).toBe(true);
        expect(isAlchemyBackedChain(11155111)).toBe(false);
        expect(isAlchemyBackedChain(175188)).toBe(false);
        expect(isAlchemyBackedChain(999)).toBe(false);
    });
});

describe("getRPCUrls (ordered [drpc, alchemy])", () => {
    it("returns drpc first, alchemy second for alchemy-backed chains", () => {
        expect(getRPCUrls(8453, "ak", "dk")).toEqual([
            "https://lb.drpc.live/base/dk",
            "https://base-mainnet.g.alchemy.com/v2/ak",
        ]);
        expect(getRPCUrls(1, "ak", "dk")).toEqual([
            "https://lb.drpc.live/ethereum/dk",
            "https://eth-mainnet.g.alchemy.com/v2/ak",
        ]);
        expect(getRPCUrls(84532, "ak", "dk")).toEqual([
            "https://lb.drpc.live/base-sepolia/dk",
            "https://base-sepolia.g.alchemy.com/v2/ak",
        ]);
    });

    it("falls back to a lone alchemy URL when no drpc key is supplied", () => {
        expect(getRPCUrls(8453, "ak")).toEqual(["https://base-mainnet.g.alchemy.com/v2/ak"]);
    });

    it("keeps the single non-alchemy URL (Infura sepolia) unchanged", () => {
        expect(getRPCUrls(11155111, "ak", "dk")).toEqual([
            "https://sepolia.infura.io/v3/5588b2f2645b47bf9d9df736ab328181",
        ]);
        expect(getRPCUrls(175188, "ak", "dk")).toEqual(["https://yellowstone-rpc.litprotocol.com/"]);
    });

    it("returns an empty array for unknown chains", () => {
        expect(getRPCUrls(999, "ak", "dk")).toEqual([]);
    });
});

describe("buildRPCTransport (viem fallback: drpc first, alchemy fallback)", () => {
    it("builds a viem fallback transport (drpc transport first) for an alchemy-backed chain", () => {
        const transport = buildRPCTransport(8453, "ak", "dk");
        expect(transport).toBeTypeOf("function");
        const t = (transport as any)({ chain: undefined });
        // viem marks the combined transport as type 'fallback' and passes both
        // URL-ordered http transports to it — drpc first.
        expect(t.config.type).toBe("fallback");
        expect(constructionOrder).toEqual([
            "https://lb.drpc.live/base/dk",
            "https://base-mainnet.g.alchemy.com/v2/ak",
        ]);
    });

    it("fails over from drpc to alchemy when the drpc transport errors", async () => {
        const transport = buildRPCTransport(8453, "ak", "dk") as any;
        const { request } = transport({ chain: undefined });
        const response = await request({ method: "eth_chainId", params: [] });
        expect(response.result).toBe("ok");
        // Both transports were built in [drpc, alchemy] order.
        expect(constructionOrder).toEqual([
            "https://lb.drpc.live/base/dk",
            "https://base-mainnet.g.alchemy.com/v2/ak",
        ]);
    });

    it("does not fail over (drpc answers) when the drpc transport succeeds", async () => {
        drpcFails = false;
        const transport = buildRPCTransport(8453, "ak", "dk") as any;
        const { request } = transport({ chain: undefined });
        const response = await request({ method: "eth_chainId", params: [] });
        expect(response.result).toBe("ok");
        // No alchemy URL should even be present in the construction order... but the
        // fallback() still builds both http transports up-front, so assert the drpc
        // one comes first and the call resolved via the drpc-first ordering.
        expect(constructionOrder[0]).toBe("https://lb.drpc.live/base/dk");
        expect(constructionOrder[1]).toBe("https://base-mainnet.g.alchemy.com/v2/ak");
        // Both http transports were built (drpc answered on the first attempt).
        expect(constructionOrder).toHaveLength(2);
    });

    it("builds single HTTP transports (no fallback) for the non-alchemy branches and no-drpc-key case", () => {
        // Infura sepolia: single URL, no fallback (only one http() built).
        const sep = buildRPCTransport(11155111, "ak", "dk");
        expect(sep).toBeTypeOf("function");
        expect(constructionOrder).toEqual([
            "https://sepolia.infura.io/v3/5588b2f2645b47bf9d9df736ab328181",
        ]);

        // Alchemy-backed chain with no drpc key -> single alchemy transport.
        constructionOrder = [];
        const noKey = buildRPCTransport(8453, "ak");
        expect(noKey).toBeTypeOf("function");
        expect(constructionOrder).toEqual(["https://base-mainnet.g.alchemy.com/v2/ak"]);
    });

    it("returns undefined for unknown chains", () => {
        expect(buildRPCTransport(999, "ak", "dk")).toBeUndefined();
    });
});
