import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { verifyMessage } from 'viem';
import { NillionPkpClient } from './services/nildb.pkp.service.js';
import {
  ValidationFailure,
  validateDelegation,
  validatePoolCreate,
  validateRegisterBuilder,
  validateResults,
  validateScore,
  validateSurveyCreate,
  validateSurveyUpdate,
  validateUsageKey,
} from './validation.js';

// ====== APP FACTORY ======
//
// createApp(services) builds the fully-wired Express app (middleware, routes,
// /api mount, 404 fallback) WITHOUT booting anything: no env reads, no service
// construction, no initStorage()/nildb.initBuilder(), no listening. main.ts
// owns the boot sequence (env -> services -> createApp -> listen) so the app
// can be imported and exercised directly in tests with fake services.

export interface AppServices {
  pool: any;
  survey: any;
  viem: any;
  lit: any;
  litPoolKeys: any;
}

function badRequest(res: Response, failure: ValidationFailure | null): boolean {
  if (!failure) return false;
  res.status(400).json(failure);
  return true;
}

export function createApp(services: AppServices) {
  const { pool, survey, viem, lit, litPoolKeys } = services;

  // ====== APP SETUP ======

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))

  // ====== MIDDLEWARE ======

  // Verify message signature — attaches isValidSignature to req.
  // NOTE: intentionally NOT wired to any route in this PR. Auth wiring is a
  // separate follow-up; this middleware is preserved verbatim (dead) so the
  // decision point is explicit rather than silently removed.
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
    if (badRequest(res, validatePoolCreate(req.body))) return;
    try {
      res.status(201).json(await pool.create(req.body));
    } catch (error: any) {
      console.error(error);
      res.status(500).json({ error: 'CREATE_FAILED', detail: error.message });
    }
  });

  // Create a new survey
  // Body: { signature, userAddress, surveyConfig, poolConfig, idempotencyKey? }
  router.post('/surveys', async (req: Request, res: Response) => {
    if (badRequest(res, validateSurveyCreate(req.body))) return;
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
  // Body: { survey, poolConfig, surveyConfig } — SURVEY_ID_MISMATCH is preserved.
  router.put('/surveys/:id', async (req: Request, res: Response) => {
    if (badRequest(res, validateSurveyUpdate(req.body, req.params.id))) return;
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
  // Body: { signature, signer, poolId }
  router.post('/surveys/:id/score', async (req: Request, res: Response) => {
    if (badRequest(res, validateScore(req.body))) return;
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
  // Body: { auth, survey: queryIds, poolId, poolConfig }
  router.post('/surveys/:id/results', async (req: Request, res: Response) => {
    if (badRequest(res, validateResults(req.body))) return;
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

  router.post('/surveys/:surveyId/delegation', async (req: Request, res: Response) => {
    if (badRequest(res, validateDelegation(req.body))) return;
    const { surveyId } = req.params;
    const { userDid, signature, userAddress, poolId, poolConfig } = req.body;

    console.log({ userDid, signature, poolId, poolConfig })

    const { delegation } = await survey.getUserDelegation(signature, userAddress, poolId, poolConfig, surveyId, userDid)

    res.json({ delegation });
  });

  router.post('/builder/register', async (req: Request, res: Response) => {
    if (badRequest(res, validateRegisterBuilder(req.body))) return;
    res.json(await pool.registerBuilder(req.body))
  });

  // --- Lit Protocol ---

  // Request payment delegation for Lit decryption
  // Body: { userAddr, signature, poolId }
  router.post('/lit/usage-key', async (req: Request, res: Response) => {
    if (badRequest(res, validateUsageKey(req.body))) return;
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

  return app;
}
