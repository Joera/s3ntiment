import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';
import { IServices } from '../services.js';
import { store } from '../state/store.js';
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' with { type: 'json' };

import { router } from '../router.js';
import { ensureBootstrapKey } from '../bootstrap.factory.js';


export class UsedCardController {

    private reactiveViews: any[] = [];
    private services: IServices;
    private surveyId: string;

    constructor(services: IServices, surveyId: string
    ) {
        this.services = services;
        this.surveyId = surveyId
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        console.log(app)
        if (!app) return;

        app.innerHTML = `<div id="used-card-content" class="centered"></div>`;

        const view = reactive('#used-card-content', () => {

            return `
                <div class="onboarding-message">
                    <h2>Used card</h2>
                    <p>This invite has already been used. If that was you, you can sign back in with your e-mail</p>
                    <button id="sign-in-btn" class="btn-primary" style="margin-top: 1.5rem">Sign in</button>
                </div>
            `;
        });

        if (view) {
            view.bind(store.ui$);
            this.reactiveViews.push(view);
        }
    }

    async render() {
        
        this.renderTemplate();
        this.attachListeners();

    }

    attachListeners () {
        
        const btn = document.getElementById("sign-in-btn");

        btn?.addEventListener("click", async () => {
           
            // Deferred identity: the WaaP email/phone re-login is deferred to the
            // post-survey persist step. "Sign in" here re-establishes the on-device
            // random bootstrap leaf `E` (load-or-create + persist) and proceeds.
            await ensureBootstrapKey(this.services);
            router.navigate(`/surveys/${this.surveyId}`)
        });
    }


    destroy() {
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
    }
}