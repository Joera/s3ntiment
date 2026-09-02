import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';
import { validateScoreInput } from '@s3ntiment/shared';
import { IServices } from '../services.js';
import { store } from '../state/store.js';
import { loadAnchorAddressFromStorage } from '../state/storage.js';
import { router } from '../router.js';

const BACKENDURL = import.meta.env.VITE_PROD == "true" ? import.meta.env.VITE_BACKEND_PROD : import.meta.env.VITE_BACKEND_DEV;

export class CompletedController {

    private reactiveViews: any[] = [];
    private services: IServices;
    private surveyId: string;
    private docId: string;
    private score: any;

    constructor(services: IServices, surveyId: string, docId: string) {
        this.services = services;
        this.surveyId = surveyId;
        this.docId = docId;
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        if (!app) return;

        console.log("ACTIVE", store.activeSurvey)

        app.innerHTML = `<div id="completed-content" class="centered"></div>`;

        const view = reactive('#completed-content', () => {

            // "Secure your stealth account" CTA: shown iff this device has NOT yet
            // secured an anchor (RFC §9.2 — `anchor_address === undefined` is the
            // single source of truth; no separate boolean).
            const anchorAddress = loadAnchorAddressFromStorage();
            const showSecureCta = anchorAddress === undefined;

            return `
                ${store.activeSurvey?.isScored
                    ? this.score
                        ? `<div>You scored</div>
                        <div class="completed-container score">
                            <div><span class="large">${this.score.score}</span></div>
                            <div><span>out of ${this.score.max}</span></div>
                        </div>
                        <div class="onboarding-message">
                            <h3>Thank you for your feedback</h3>
                            <p>It's fine to close this window now.</p>
                        </div>`
                        : `<loading-spinner color="rgb(32, 85, 74)" message="calculating<br/>your score"></loading-spinner>`
                    : `<div class="onboarding-message">
                        <h3>Thank you for your feedback</h3>
                        <p>It's fine to close this window.</p>
                    </div>`
                }
                ${showSecureCta
                    ? `<div style="margin-top:1.5rem">
                        <button id="secure-account-btn" class="btn-primary">Secure your stealth account</button>
                      </div>`
                    : ''}
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

        if (store.activeSurvey?.isScored) {
            const signer = this.services.account.getSignerAddress();
            const signature = await this.services.account.signMessage(`s3ntiment:score:${this.surveyId}`);

            const scoreBody = { signer, signature, poolId: store.activeSurvey.pool };
            // Producer-side boundary defense: a payload the backend would reject
            // (400/401) is caught here and surfaced instead of sent. validateScoreInput
            // throws on failure (canonical zod module); we catch + log + abort exactly
            // like the previous hand-rolled log-and-return path.
            try {
                validateScoreInput(scoreBody);
            } catch (e) {
                console.error('[nillcc] score: payload would be rejected by backend', e);
                store.setUI({});
                return;
            }

            const response = await fetch(`${BACKENDURL}/api/surveys/${this.surveyId}/score`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scoreBody)
            });

            if (response.ok) {
                const r: any = await response.json();
                this.score = r.score;
            } else {
                console.log("ERROR", response);
            }

            store.setUI({});
        }
    }

    destroy() {
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
    }

    attachListeners () {
            
            const btn = document.getElementById("btn-close");
    
            btn?.addEventListener("click", async () => {
                window.close();
            });

            // Results-page CTA -> /account (secure your stealth account). Only
            // rendered when anchor_address === undefined, so the listener is inert
            // once secured.
            const secureBtn = document.getElementById("secure-account-btn");
            secureBtn?.addEventListener("click", async () => {
                router.navigate('/account');
            });
        }
    
}