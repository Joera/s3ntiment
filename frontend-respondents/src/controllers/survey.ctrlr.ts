import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';

import '../components/survey-questions.js';
import { IServices } from '../services.js';
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
import { fetchAndDecryptSurveyWithRespondent, isScored, PoolConfig, Survey } from '@s3ntiment/shared';

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
   * Pool config (pkpId/pkpDid/…) used to submit a response. It is NOT a plain
   * store lookup — it is persisted inside the decrypted EncryptedConfig (the
   * same `config` field the backend reads as `surveyConfig.config`), so it is
   * plumbed out of the decrypted survey in render() rather than read off an
   * unset `this.pool`.
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
        const survey = await fetchAndDecryptSurveyWithRespondent(
          this.services, surveyStore, this.surveyId, this.poolConfig, BACKENDURL
        );

        this.survey = survey;

        // R1 fix: the pool config lives on the decrypted EncryptedConfig, not on
        // a separately-set `this.pool`. Plumb it out so setSurveyListener() can
        // dereference poolConfig.pkpId/pkpDid instead of always throwing on an
        // unset pool.
        this.poolConfig = (survey as any).config as PoolConfig | undefined;

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

      const args = {
        userDid: this.services.nillDB.userDidString, 
        signature, 
        userAddress: this.services.account.getSignerAddress(),
        poolId: this.survey?.pool, 
        pkpId: this.poolConfig?.pkpId, 
        pkpDid: this.poolConfig?.pkpDid 
      }

      const { delegation } = await fetch(`${BACKENDURL}/api/surveys/${this.surveyId}/delegation`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(args)
      }).then(r => r.json());

      const result = await this.services.nillDB.storeOwned(docIUd, this.survey!, this.poolConfig!, event.detail.answers, this.surveyId, delegation)

      console.log(result)

      if (result.ok) router.navigate(`complete/${this.surveyId}/${docIUd}`)

    });
  }
}