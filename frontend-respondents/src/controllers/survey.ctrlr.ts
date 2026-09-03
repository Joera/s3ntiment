import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';

import '../components/survey-questions.js';
import { IServices } from '../services.js';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { fetchAndDecryptSurveyWithRespondent, isScored, PoolConfig, Survey, validateDelegationInput, validateDelegationOutput } from '@s3ntiment/shared';

import { store } from '../state';
import { createUserDataObject } from '@s3ntiment/shared'
import { router } from '../router.js';

const BACKENDURL = import.meta.env.VITE_PROD == "true" ? import.meta.env.VITE_BACKEND_PROD : import.meta.env.VITE_BACKEND_DEV;


export class SurveyController {
  private reactiveViews: any[] = [];
  documentId: any;
  services: IServices;
  surveyId: string;
  survey?: Survey;
  /**
   * Pool config (pkpId/pkpDid/…) used to submit a response. It is sourced from
   * the decrypted EncryptedConfig's `poolConfig` field (persisted into the
   * survey by the backend at create/update time). There is NO other
   * authoritative read path exposing pkpId to a respondent, so it is plumbed
   * out of the decrypted survey in render() rather than read off an unset
   * `this.pool`.
   */
  poolConfig?: PoolConfig;

  constructor(services: IServices, surveyId: string) {
    this.services = services;
    this.surveyId = surveyId;
  }

  private renderLoading() {
    const app = document.querySelector('#app');
    if (!app) return;

    app.innerHTML = `
      <div id="survey-content" class="container centered">
        <loading-spinner color="rgb(32, 85, 74)" message="decrypting<br/>survey"></loading-spinner>
      </div>
    `;
  }

  private renderWarning(msg: string) {
    const app = document.querySelector('#app');
    if (!app) return;

    app.innerHTML = `
      <div id="survey-content" class="container centered">Decryption failed: <br/> ${msg}</div>
    `;
  }

  private renderTemplate() {
    const app = document.querySelector('#app');
    if (!app) return;

    app.innerHTML = `
      <div id="survey-content" class="container centered"></div>
    `;

    const view = reactive('#survey-content', () => {
        return `<survey-questions class="container container-small" survey-id="${this.surveyId}"></survey-questions>`;
    });

    if (view) {
      view.bind(store.surveys$);
      this.reactiveViews.push(view);
    }
  }

  async process() {}

  async render() {

    const surveyFromStore = store.getSurveyData(this.surveyId);

    if(surveyFromStore && surveyFromStore.pool) { 

      this.renderLoading();

      try {
        // The shared helper derives poolConfig internally from the decrypted
        // EncryptedConfig (which now carries poolConfig.pkpId), so render() no
        // longer passes an undefined `this.poolConfig` that made the decrypt
        // deref crash.
        const survey = await fetchAndDecryptSurveyWithRespondent(
          this.services, surveyStore, this.surveyId, BACKENDURL
        );

        this.survey = survey;

        // The REAL PoolConfig rides on the decrypted survey (the EncryptedConfig
        // is spread flat onto the return). Source pkpId/pkpDid from there so
        // setSurveyListener() can dereference poolConfig.safe/pkpId/pkpDid
        // instead of always throwing on an unset pool.
        this.poolConfig = survey.poolConfig;

        survey.isScored = isScored(survey.groups);
        store.setSurveyData(this.surveyId, survey);
        store.persistSurveys();
        this.renderTemplate();
        this.setSurveyListener();

      } catch (e: any) {
        console.error('Failed to load survey:', e.message);
        this.renderWarning(e.message); // show the actual reason
      }
    }
        
    else {
      alert("survey and pool not found")
    }
  }

  destroy() {
    this.reactiveViews.forEach(view => view.destroy());
    this.reactiveViews = [];
  }

  async setSurveyListener() {

    document.addEventListener('survey-complete', async (event: any) => {
      
      console.log('Survey completed!');
      const seed = await this.services.account.createNillDBSeed();
      await this.services.nillDB.init(seed);

      // new / update? 
      const docIUd = crypto.randomUUID();

      // replace with pool issued lit action 
      const signature = await this.services.account.signMessage(`s3ntiment:submit`);

      // GAP-19: the backend delegation route consumes a `poolConfig` object
      // (poolConfig.safe / poolConfig.pkpId / poolConfig.pkpDid) — see
      // nillcc-backend/src/main.ts POST /surveys/:surveyId/delegation. Sending
      // flat pkpId/pkpDid previously left `safe` undefined and made the handler
      // throw (NillionPkpClient.getUserWriteDelegation requires poolConfig.safe
      // for the owner-invocation action). Send the full pool config so the
      // handler derives a delegation `storeOwned` can use.
      const args = {
        userDid: this.services.nillDB.userDidString, 
        signature, 
        userAddress: this.services.account.getSignerAddress(),
        poolId: this.survey?.pool, 
        poolConfig: this.poolConfig,
      }

      // Producer-side boundary defense: a payload the backend would reject
      // (400/401) is caught here and surfaced instead of sent. validateDelegationInput
      // throws on failure (canonical zod module); we catch + log + abort the submit
      // exactly like the previous hand-rolled log-and-return path.
      try {
        validateDelegationInput(args);
      } catch (e) {
        console.error('[nillcc] delegation submit: payload would be rejected by backend', e);
        return;
      }

      const delegationResponse = await fetch(`${BACKENDURL}/api/surveys/${this.surveyId}/delegation`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(args)
      });

      if (!delegationResponse.ok) {
          // Real backend error — surface it and stop. Do NOT run the output
          // validator on the 4xx/5xx body, which would throw a misleading zod
          // error over the error shape instead of the real one.
          console.error('delegation fetch failed (backend):', await delegationResponse.text());
          return;
      }

      const delegationBody = await delegationResponse.json();
      // Output conformance: the delegation boundary returns { delegation }. Runs
      // only on an ok response; a wrong shape fails loudly.
      validateDelegationOutput(delegationBody);
      const { delegation } = delegationBody;

      const result = await this.services.nillDB.storeOwned(docIUd, this.survey!, this.poolConfig!, event.detail.answers, this.surveyId, delegation)

      console.log(result)

      if (result.ok) router.navigate(`complete/${this.surveyId}/${docIUd}`)

    });
  }
}