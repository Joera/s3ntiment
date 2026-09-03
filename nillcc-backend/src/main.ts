import './env.js';  // must be first
import { base } from 'viem/chains';

import { ViemService, LitService, IPFSMethods } from "@s3ntiment/shared";
import { initStorage, LitPoolKeys } from "@s3ntiment/shared/node"
import { NilDBBuilderService } from './services/nildb.builder.service.js';
import { PoolController } from './pool.ctrlr.js';
import { SurveyController } from './survey.ctrlr.js';
import { createApp } from './app.js';

// ====== ENV ======

const PINATA_JWT = process.env.VITE_PINATA_JWT || "";
const PINATA_GATEWAY = process.env.VITE_PINATA_GATEWAY || "";
const KUBO_ENDPOINT = process.env.VITE_KUBO_ENDPOINT || "";
const ALCHEMY_KEY = process.env.VITE_ALCHEMY_KEY || "";
const DRPC_KEY = process.env.VITE_DRPC_KEY || "";
const LIT_NETWORK = process.env.VITE_LIT_NETWORK || "";

// ====== SERVICES ======

const viem = new ViemService(base, ALCHEMY_KEY, DRPC_KEY);
const nildb = new NilDBBuilderService();
const lit = new LitService({
  environment: process.env.VITE_LIT_NETWORK == "prod" ? "prod" : "dev",
  accountKey: process.env.VITE_LIT_NETWORK == "prod" ? process.env.VITE_LIT_API_ACCOUNT_KEY!: process.env.VITE_LIT_API_DEV_ACCOUNT_KEY!,
});
await initStorage();
const litPoolKeys = new LitPoolKeys()
const ipfs = new IPFSMethods(KUBO_ENDPOINT, PINATA_JWT, PINATA_GATEWAY);
const pool = new PoolController(lit, litPoolKeys, nildb)
const survey = new SurveyController(nildb, lit, litPoolKeys, ipfs, viem);
await nildb.initBuilder();

// ====== APP ======
// All middleware + route wiring lives in createApp() (see app.ts). Everything
// above — env reads, service construction, async init — is the boot sequence
// and stays here, so the Express app itself is importable without booting.

const app = createApp({ pool, survey, viem, lit, litPoolKeys });

// ====== PROCESS GUARDS ======
// Node >=15 terminates on unhandled promise rejections / uncaught exceptions by
// default — which is exactly how an upstream Lit/NilDB/IPFS/RPC failure (e.g. a
// Lit 403 on a delegation action) used to crash the whole backend into an nginx
// 502 (audit survey-delegation-502). Register guards so any error that still
// escapes a route's try/catch is logged and the process stays alive, degrading
// to the route's 500 JSON instead of killing the service. We intentionally do
// NOT exit: a single bad upstream response must never take the backend down.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] kept alive:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] kept alive:', err);
});

// ====== SERVER STARTUP ======

const PORT = process.env.PORT || 8080;

async function startServer() {
    try {
        app.listen(PORT, () => {
            console.log(`server running at ${PORT}`);
            console.log("kip")
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
