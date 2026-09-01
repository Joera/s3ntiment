import './env.js';  // must be first
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { NilDBBuilderService } from './services/nildb.builder.service.js';
import { base } from 'viem/chains';

import { SurveyController } from './survey.ctrlr.js';
import { ViemService, LitService, IPFSMethods } from "@s3ntiment/shared";
import {initStorage, LitPoolKeys } from "@s3ntiment/shared/node"
import { verifyMessage } from 'viem';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { PoolController } from './pool.ctrlr.js';
import { NillionPkpClient } from './services/nildb.pkp.service.js';

// ====== APP SETUP ======

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

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


// ====== MIDDLEWARE ======

// Verify message signature — attaches isValidSignature to req
async function verifySignature(req: Request, res: Response, next: NextFunction) {
    const { signature, signer } = req.body;
    if (!signature || !signer) {
        res.status(401).json({ error: 'MISSING_SIGNATURE' });
        return;
    }
    const message = req.body.message || `s3ntiment:${req.path}`;
    const valid = await verifyMessage({ message, signature, address: signer });
    if (!valid) {
        res.status(401).json({ error: 'INVALID_SIGNATURE' });
        return;
    }
    next();
}

// ====== ROUTES ======

const router = express.Router();

// --- Surveys ---

router.post('/pools', async (req: Request, res: Response) => {
    try {
        res.status(201).json(await pool.create(req.body));
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'CREATE_FAILED', detail: error.message });
    }
});


// Create a new survey
// Body: { surveyConfig, safeAddress, idempotencyKey? }
router.post('/surveys', async (req: Request, res: Response) => {
    try {
        const surveyCid = await survey.create(req.body);
        res.status(201).json({ cid: surveyCid });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'CREATE_FAILED', detail: error.message });
    }
});

// Get survey metadata (for agents to inspect before acting)
// Returns on-chain + IPFS config (respondent-safe, no answer key)
router.get('/surveys/:id', async (req: Request, res: Response) => {
    try {
        const data = await survey.get(req.params.id);
        if (!data) {
            res.status(404).json({ error: 'NOT_FOUND' });
            return;
        }
        res.json(data);
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'FETCH_FAILED', detail: error.message });
    }
});


// Update survey config and re-encrypt
router.put('/surveys/:id', async (req: Request, res: Response) => {
    if (req.params.id !== req.body.surveyConfig?.id) {
        res.status(400).json({ error: 'SURVEY_ID_MISMATCH' });
        return;
    }
    try {
        const surveyCid = await survey.update(req.body);
        console.log(surveyCid);
        res.status(200).json({ cid: surveyCid });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'UPDATE_FAILED', detail: error.message });
    }
});

// Submit survey answers
// Body: { userData, signature, signer }
// Score a submission (separate roundtrip, fires after submit when applicable)
// Body: { signature, signer }
router.post('/surveys/:id/score', async (req: Request, res: Response) => {
    try {
        const { signature, signer, poolId } = req.body;
        const surveyId = req.params.id;

        const isValidSignature = await verifyMessage({
            message: `s3ntiment:score:${surveyId}`,
            signature,
            address: signer
        });

        const isRespondent = await viem.read(
            surveyStore.address as `0x${string}`,
            surveyStore.abi,
            'isPoolMember',
            [poolId, signer]
        );

        if (!isValidSignature || !isRespondent) {
            res.status(403).json({ error: 'UNAUTHORIZED' });
            return;
        }

        const result = await survey.score(surveyId, signer);
        res.json({ score: result });

    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'SCORE_FAILED', detail: error.message });
    }
});

// Get aggregated survey results (owner only)
// Body: { groups, signature, signer }
router.post('/surveys/:id/results', async (req: Request, res: Response) => {
    try {
        const surveyId = req.params.id;
        const contract = surveyStore.address;
        const { auth, groups, survey, poolId, poolConfig } = req.body;
        const usageKey = await litPoolKeys.get(poolId);
        const nillPkp = new NillionPkpClient(lit, poolId, poolConfig.safe, contract)

        const runIds = await nillPkp.runQuery(auth, survey, poolConfig, usageKey!)
        const results = await nillPkp.readQueryResults(auth, poolConfig, usageKey!, runIds);


        console.log(results)

        res.json({ results });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'RESULTS_FAILED', detail: error.message });
    }
});

router.post('/surveys/:surveyId/delegation', async (req, res) => {

    const { surveyId } = req.params;
    const { userDid, signature, userAddress, poolId, poolConfig} = req.body;

    console.log({ userDid, signature, poolId, poolConfig })

    const { delegation } = await survey.getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid)
    
    res.json({ delegation });
});

router.post('/builder/register', async (req, res) => {

   res.json(await pool.registerBuilder(req.body))
})

// --- Lit Protocol ---

// Request payment delegation for Lit decryption
// Body: { userAddr, signature, poolId }
router.post('/lit/usage-key', async (req: Request, res: Response) => {
    try {

        const { userAddr, signature, poolId } = req.body;

        const hasValidSignature = await viem.publicClient.verifyMessage({
            address: userAddr,
            message: 'Request capability to decrypt',
            signature
        });

        if (!hasValidSignature) {
            res.status(401).json({ error: 'INVALID_SIGNATURE' });
            return;
        }

        const key = await litPoolKeys.get(poolId);

        res.json({ apiKey: key });

    } catch (error: any) {
        console.error(error);
        res.status(500).json({ error: 'DELEGATION_FAILED', detail: error.message });
    }
});

// ====== MOUNT ROUTER ======

app.use('/api', router);

// ====== 404 FALLBACK ======

app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'NOT_FOUND' });
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