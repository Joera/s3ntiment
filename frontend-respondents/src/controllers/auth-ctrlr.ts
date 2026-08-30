import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';
import { IServices } from '../services.js';
import { store } from '../state/store.js';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';

import { router } from '../router.js';
import { ensureBootstrapKey } from '../bootstrap.factory.js';
import { CardData, fetchSurvey } from '@s3ntiment/shared';
import { Card, parseCardURL } from '@s3ntiment/shared';
import { removeSplash } from '../onpageload.js';


export class AuthController {

    private reactiveViews: any[] = [];
    private services: IServices;

    constructor(services: IServices) {
        this.services = services;
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        if (!app) return;

        app.innerHTML = `<div id="auth-content" class="centered"></div>`;

        const view = reactive('#auth-content', () => {

            return `
                <loading-spinner message="safety takes time" color="rgb(32,85,74)"></loading-spinner>
                `


        
            // return `
            //     <div class="onboarding-message">
            //      <h2>Welcome</h2>
            //      <p></p>
            //     </div>
            // `;


        });

        if (view) {
            view.bind(store.ui$);
            this.reactiveViews.push(view);
        }
    }

    async render() {

        const cardData: CardData | null = await parseCardURL(window.location.href);
        
        if(cardData) {

            const card = new Card(cardData)

            this.renderTemplate();

            const [ipfsCid, poolId, createdAt] = await fetchSurvey(this.services, surveyStore, cardData.surveyId!);

            store.setSurveyData(cardData.surveyId!, {
                id: cardData.surveyId,
                pool: poolId
            })

            // Deferred identity: at entry the random bootstrap leaf `E` is
            // pre-registration, so establish E (load-or-create + persist) on the
            // signer rather than running the human-wallet WaaP/OPRF authenticate().
            await ensureBootstrapKey(this.services);

            try {
                const tx = await card.register(this.services, surveyStore, poolId);

                console.log(tx)
            
                if (tx.receipt?.status === 'success') {
                    console.log("new card registered")
                    router.navigate('/surveys/' + cardData.surveyId);

                } else {
                    alert('❌ Card validation failed');
                }
            } catch (error) {

                alert('❌ Card validation failed');
            }
        }   

    }

    destroy() {
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
    }
}