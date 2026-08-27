/// <reference types="vite/client" />


import { Batch, Survey } from '@s3ntiment/shared';
import '../components/draft-survey-editor.js';
import { createBatch } from '../factories/survey.factory.js';
import { IServices } from '../services/services.js';
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' }
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

      let poolResponse: any = await fetch(`${BACKENDURL}/api/pools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({   
          signature,
          userAddress,
          poolId,
          safeAddress
        })
      });

      if (!poolResponse.ok) store.setUI({ newStep: 'error' });

      const { pkpId, pkpDid, groupId, delegation }  = await poolResponse.json();

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

      // register builder with nillion 
      let builderResponse: any = await fetch(`${BACKENDURL}/api/builder/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({   
          signature, 
          userAddress, 
          poolId, 
          pkpId, 
          pkpDid, 
          safeAddress
        })
      });

      if (!builderResponse.ok) console.log("builder registration failed") 

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

    console.log(surveyConfig)

    let surveyResponse: any = await fetch(`${BACKENDURL}/api/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({  
        signature,
        userAddress,
        surveyConfig
      })
    });

    if (!surveyResponse.ok) store.setUI({ newStep: 'error' });

    const { cid }  = await surveyResponse.json();

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
