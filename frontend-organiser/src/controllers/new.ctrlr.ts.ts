/// <reference types="vite/client" />


import { Batch, Survey } from '@s3ntiment/shared';
import {
  validatePoolCreateInput,
  validatePoolCreateOutput,
  validateRegisterBuilderInput,
  validateRegisterBuilderOutput,
  validateSurveyCreateInput,
  validateSurveyCreateOutput,
} from '@s3ntiment/shared/nillcc';
import { buildPoolCreatePayload, buildRegisterBuilderPayload, buildSurveyCreatePayload } from './nillcc-payloads.js';
import '../components/draft-survey-editor.js';
import { createBatch } from '../factories/survey.factory.js';
import { IServices } from '../services/services.js';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { store } from '../state/store.js';
import { router } from '../router.js';

const BACKENDURL = import.meta.env.VITE_PROD == "true" ? import.meta.env.VITE_BACKEND_PROD : import.meta.env.VITE_BACKEND_DEV;

export class NewSurveyController {
  private reactiveViews: any[] = [];
  private services: IServices;

  constructor(services: IServices) {
    this.services = services;
   // this.handleSurveySubmit = this.handleSurveySubmit.bind(this);
  }

  private renderTemplate() {
    const app = document.querySelector('#app');
    if (!app) return;

    app.innerHTML = `
      <div id="new-survey" class="container centered">
        <draft-survey-editor class="container centered"></draft-survey-editor>
      </div>
    `;

    this.setSurveyListener();
  }

  async process() {
    // @ts-ignore
 
  }

  async render() {
    this.renderTemplate();
    this.process();
  }

  destroy() {
    document.removeEventListener('survey-submit', this.handleSurveySubmit);
    this.reactiveViews.forEach(view => view.destroy());
    this.reactiveViews = [];
  }

  /*
   * handleSurveySubmit — full create-a-survey flow, top to bottom.
   * Runs on the 'survey-submit' custom event fired by <draft-survey-editor>.
   *
   * 1. Extract `survey` from event.detail.survey (the draft the editor emits).
   * 2. Generate IDs: `surveyId = crypto.randomUUID()`, and `poolId` = the
   *    survey's existing pool, or a fresh crypto.randomUUID() if none is set.
   * 3. Branch on `isNewPool` (true when survey.pool is absent):
   *    - NEW pool: `safeAddress = safe.connectToFreshSafe(poolId)` (mints a
   *      fresh Safe for the new pool).
   *    - EXISTING pool: look up the pool in the store, reuse its saved
   *      `safeAddress`, and call `safe.connectToExistingSafe(safeAddress)`.
   * 4. Get the signer: `userAddress = safe.getSignerAddress()`.
   * 5. Sign the message "Request owner invocation" → `signature`.
   * 6. If isNewPool — the NEW-POOL sub-sequence:
   *    a. UI step → 'creating-pool'.
   *    b. Build pool-create payload + zod-validate INPUT (fast-fail before
   *       the round-trip).
   *    c. POST `${BACKENDURL}/api/pools`. On !ok → UI step 'error' + return.
   *    d. Parse pool JSON + zod-validate OUTPUT (must keep the contract the
   *       FE derefs below).
   *    e. Destructure { pkpId, pkpDid, groupId } from the response.
   *    f. UI step → 'creating-invites'. For each batch call createBatch(...)
   *       and collect the resulting batch ids as `batchIds`.
   *    g. UI step → 'register-pool'. Register the pool on chain:
   *       safe.write(createSurvey, [surveyId, poolId, "0", batchIds]).
   *    h. Build register-builder payload + zod-validate INPUT.
   *    i. POST `${BACKENDURL}/api/builder/register`. On !ok → log + return.
   *    j. zod-validate OUTPUT, then build `config`
   *       (safe, chainId, litNetwork, pkpId, pkpDid, groupId).
   *    k. store.addPool({ id: poolId, name, safeAddress, batches, createdAt, config }).
   * 7. SHARED survey-create sub-sequence (new pool AND existing pool):
   *    a. UI step → 'creating-survey'.
   *    b. Build `surveyConfig` (id, title, pool, introduction, groups, batches).
   *    c. Grab `poolConfig = store.getPool(poolId)?.config` (stored above for
   *       a fresh pool; already present for an existing pool).
   *    d. Build survey-create payload + zod-validate INPUT (poolConfig must
   *       carry pkpId / pkpDid / safe or the boundary rejects it).
   *    e. POST `${BACKENDURL}/api/surveys`. On !ok → UI step 'error' + return.
   *    f. Parse survey JSON + zod-validate OUTPUT (expects { cid }).
   *    g. Destructure `cid` from the response.
   * 8. If `ipfs.isCID(cid)` is true:
   *    a. Write `updateSurvey` on chain with [surveyId, cid.toString()].
   *    b. On tx success (receipt.status == "success"): add every batch to the
   *       store, set surveyConfig.batches, add the survey to the store, then
   *       navigate to `/batch/<pool>/<batchId>`.
   *    c. On tx failure: alert('create survey tx failed ' + txHash) + UI 'error'.
   * 9. End (no explicit return on the success path; method finishes).
   */
  private handleSurveySubmit = async (event: any) => {

    const survey = event.detail.survey;
    console.log("ready to submit", survey)

    const surveyId = crypto.randomUUID();
    const poolId = survey.pool ?? crypto.randomUUID();
    const isNewPool = !survey.pool;
    let safeAddress; 
    if (isNewPool) {
      safeAddress = await this.services.safe.connectToFreshSafe(poolId);
    } else {
        const pool = store.getPool(poolId);
        safeAddress = pool!.safeAddress;
        await this.services.safe.connectToExistingSafe(safeAddress);
    }

    console.log("safeAddress", safeAddress)

    const userAddress = this.services.safe.getSignerAddress();
    const signature = await this.services.safe.signMessage("Request owner invocation")

    if (isNewPool) {

      store.setUI({ newStep: 'creating-pool' });

      // Pool create — payload shaped + zod-validated (fast-fail) before the
      // round-trip so a mis-typed body never reaches the backend.
      const poolPayload = buildPoolCreatePayload({ signature, userAddress, poolId, safeAddress });
      validatePoolCreateInput(poolPayload);

      let poolResponse: any = await fetch(`${BACKENDURL}/api/pools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(poolPayload)
      });

      if (!poolResponse.ok) {
        // Real backend error — surface it and stop. Do NOT fall through to the
        // output validator, which would throw a misleading zod error over the
        // 4xx/5xx body instead of the real one.
        store.setUI({ newStep: 'error' });
        return;
      }

      const poolData = await poolResponse.json();
      // Output conformance: the pool identity the backend minted must keep the
      // contract the FE derefs below (pkpId / pkpDid / groupId). Only runs on
      // an ok response.
      validatePoolCreateOutput(poolData);

      const { pkpId, pkpDid, groupId } = poolData;

      // CREATE INVITES
      store.setUI({ newStep: 'creating-invites' });

      let batchIds = [];
      survey.batches = await Promise.all(
        survey.batches.map((batch: Batch) => createBatch(this.services, batch, poolId, surveyId))
      );   
      batchIds = survey.batches.map((b: Batch) => b.id);
      console.log("BATCHES", survey.batches)

        // CREATE INVITES
      store.setUI({ newStep: 'register-pool' });

      // register pool on chain .. so create collection can check ...
      const args = [surveyId, poolId, "0", batchIds];
      const res = await this.services.safe.write(surveyStore.address, surveyStore.abi, 'createSurvey', args, { waitForReceipt: true });
      console.log("create pool tx", res.receipt?.status);

      // Register builder — payload shaped + zod-validated (fast-fail) before
      // the round-trip.
      const builderPayload = buildRegisterBuilderPayload({ signature, userAddress, poolId, pkpId, pkpDid, safeAddress });
      validateRegisterBuilderInput(builderPayload);

      let builderResponse: any = await fetch(`${BACKENDURL}/api/builder/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(builderPayload)
      });

      if (!builderResponse.ok) {
        // Real backend error — log it and stop. Do NOT fall through to the
        // output validator, which would throw a misleading zod error over the
        // 4xx/5xx body instead of the real one.
        console.log("builder registration failed");
        return;
      }

      validateRegisterBuilderOutput(await builderResponse.json());

      const config = {
        safe: safeAddress,
        chainId: import.meta.env.VITE_L2 == 'base' ? 8453 : 1,
        litNetwork: import.meta.env.VITE_LIT_NETWORK,
        pkpId, 
        pkpDid, 
        groupId
      }
      
      store.addPool({
            id: poolId,
            name: survey.title ?? poolId,
            safeAddress,
            batches: survey.batches.map( (b:any) => b.id),
            createdAt: Math.floor(Date.now() / 1000),
            config
        });
   } 

   // i want to move to adding surveys to existing pools .. as it takes too much time and becomes costly 
   // pool interface needs to hold info pkpId etc  
   // should it be in config? 
   // store on nill db ?
   // if i store on nill db // who is owner ? pkp ? // safe? 

      
    // CREATE SURVEY 
    store.setUI({ newStep: 'creating-survey' });
    
    const surveyConfig: Survey =  {
      id: surveyId,
      title: survey.title,
      pool: poolId,
      introduction: survey.introduction,
      groups: survey.groups,
      batches: survey.batches,
      // createdAt: BigInt(Math.floor(Date.now() / 1000))
    }

    // Pool identity travels as a separate `poolConfig` (matching backend create() /
    // update() + the delegation callers). For a fresh pool it was just stored via
    // addPool above; for an existing pool it is already in the store.
    const poolConfig = store.getPool(poolId)?.config;

    console.log(surveyConfig)

    // Survey create — payload shaped + zod-validated (fast-fail) before the
    // round-trip; poolConfig must carry pkpId / pkpDid / safe or the create
    // boundary rejects it (MISSING_POOL_CONFIG).
    const surveyPayload = buildSurveyCreatePayload({ signature, userAddress, surveyConfig, poolConfig });
    validateSurveyCreateInput(surveyPayload);

    let surveyResponse: any = await fetch(`${BACKENDURL}/api/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(surveyPayload)
    });

    if (!surveyResponse.ok) {
      // Real backend error — surface it and stop. Do NOT fall through to the
      // output validator, which would throw a misleading zod error over the
      // 4xx/5xx body instead of the real one.
      store.setUI({ newStep: 'error' });
      return;
    }

    const surveyData = await surveyResponse.json();
    // Output conformance: the create boundary returns { cid }.
    validateSurveyCreateOutput(surveyData);
    const { cid } = surveyData;

    if (this.services.ipfs.isCID(cid)) {

      const args = [surveyId, cid.toString()];
      const res = await this.services.safe.write(surveyStore.address, surveyStore.abi, 'updateSurvey', args, { waitForReceipt: true });
      console.log("Survey updated")

      if (res.receipt?.status == "success") {

        for (const batch of survey.batches) {
          store.addBatch(batch);
        }

        surveyConfig.batches = survey.batches;
        store.addSurvey(surveyConfig);

        router.navigate(`/batch/${survey.batches[0].pool}/${survey.batches[0].id}`)
      }

      else {
        alert('create survey tx failed ' +  res.txHash)
        store.setUI({ newStep: 'error' });
      }
    }
  };

  async setSurveyListener() {
    document.addEventListener('survey-submit', this.handleSurveySubmit);
  }
}
