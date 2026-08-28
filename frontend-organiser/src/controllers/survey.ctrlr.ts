
import { IServices } from "../services/services.js";
import { store } from "../state/store.js";
import { reactive } from "../utils/reactive.js";
import '../components/survey-detail-responses.js';
import '../components/pool-detail-access.js';
import '../components/survey-forms/pool-form-batches.js';
import '../components/registered-questions-editor.js';
import { router } from "../router.js";
import surveyStore from 's3ntiment-contracts/deployments/base/S3ntimentSurveyStore.json' assert { type: 'json' }
import {  fetchAndDecryptSurveyWithOwner, fetchLitApiKey, Pool, Survey } from "@s3ntiment/shared";
import { renderIcon } from "@s3ntiment/shared/assets";
import '@s3ntiment/shared/components';

const BACKENDURL = import.meta.env.VITE_PROD  == "true" ? import.meta.env.VITE_BACKEND_PROD : import.meta.env.VITE_BACKEND_DEV;

export class SurveyController {
    private reactiveViews: any[] = [];
    private services: IServices;
    private surveyId: string;
    private survey!: Survey;
    private pool!: Pool;
    private cancelled = false;

    constructor(services: IServices, surveyId: string) {

        this.services = services;
        this.surveyId = surveyId;
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        if (!app) return;

        app.innerHTML = `
            <style>
           
                .survey-header {
                    width: 100%;
                    display: flex;
                    flex-direction: row;
                    justify-content: flex-start;
                    align-items: center;
                }

                .tabs-container {
                    // border-bottom: 1px solid var(--color-too-dark);
                    margin-bottom: 2rem;
                    width: 100%;
                }

                .tabs {
                    display: flex;
                    gap: 0;
                    margin: 0 auto -1px auto;
                    padding: 0 1.5rem;
                }

                .tab {
                    padding: 1rem 1.5rem;
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 1rem;
                    font-weight: 400;
                    color: var(--color-too-dark);
                    transition: all 0.2s;
                    border-bottom: 2px solid var(--color-too-dark);
                    border-radius: 0;
                }

                .tab:hover {
                    color: black;
                }

                .tab.active {
                    color: var(--color-too-dark);
                    border-bottom-color: white;
                    border-left: 2px solid var(--color-too-dark);
                    border-top: 2px solid var(--color-too-dark);
                    border-right: 2px solid var(--color-too-dark);
                    border-bottom: 2px solid var(--color-bg);
                }

                .back-btn {
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 2rem;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    flex: 0;

                    svg {
                        height: 2.5rem;
                        width: 2.5rem;
                        fill: var(--color-too-dark)
                    }
                }

                .back-btn:hover {
                    text-decoration: underline;
                }

                .actions-container {
                    margin: 3rem 1.5rem;
                    borer-top: 1px solid var(--color-too-dark);
                }


            </style>

            <div class="container container-large">
                <div class="survey-header">
                    <button class="back-btn" id="back-btn">${renderIcon('caret')}</button>
                    <h2 id="survey-title">Loading...</h2>
                </div>

                <div class="tabs-container">
                    <div class="tabs" id="tabs-container"></div>
                </div>

                <div id="survey-container" class="container container-large centered"></div>

                <div class="actions-container">
                    <button class="btn-primary" id="btn-forget">Forget</button>
                    <button class="btn-primary" id="btn-copy">Copy</button>
                </div>
            </div>
        `;

        // Reactive survey title
        const titleView = reactive('#survey-title', () => {
            return this.survey?.title || '...';
        });

        if (titleView) {
            titleView.bind('surveys');
            this.reactiveViews.push(titleView);
        }

        // Reactive tabs active state
        const tabsView = reactive('#tabs-container', () => {
            const { resultTab } = store.ui;
            
            return `
                <button class="tab ${resultTab === 'results' ? 'active' : ''}" data-tab="results">Results</button>
                <button class="tab ${resultTab === 'questions' ? 'active' : ''}" data-tab="questions">Questions</button>

            `;
        });

        if (tabsView) {
            tabsView.bind('ui');
            this.reactiveViews.push(tabsView);
        }

        // Reactive survey content
        const view = reactive('#survey-container', () => {
            const { resultTab } = store.ui;

            switch (resultTab) {
                case 'spinner':
                    return `<loading-spinner></loading-spinner>`
                case 'results':
                    return `<survey-detail-responses class="container" survey-id="${this.surveyId}"></survey-detail-responses>`
                // case 'access':
                //     return `<survey-detail-access class="container" survey-id="${this.surveyId}"></survey-detail-access>`;
                case 'questions':
                    return `<registered-questions-editor class="container" survey-id="${this.surveyId}"></registered-questions-editor>`
                // case 'batches':
                //     return `<survey-form-batches class="container" survey-id="${this.surveyId}"></survey-form-batches>`;
                default: 
                    return ``;
            }
        });

        if (view) {
        view.bind('ui');
        this.reactiveViews.push(view);
        }

        this.setListeners();
    }
    
    
    async process() {

        // we need safeAddress to decrypt
        await this.services.safe.connectToExistingSafe(this.pool.config?.safe || "") 
        if (this.cancelled) return;
        // overwrite with decrypted content 
        this.survey = await fetchAndDecryptSurveyWithOwner(this.services, surveyStore, this.surveyId, this.pool.config!, BACKENDURL)
        if (this.cancelled) return;

        await this.refreshResponses(); 
    }

    async render() {

        const survey = store.surveys.find((s: any) => s.id === this.surveyId);
        
        if (survey && survey !== undefined) {
            this.survey = survey;
        } 

        this.pool = store.getPool(this.survey.pool!)!

        this.renderTemplate();
        this.process();
    }

    destroy() {
        this.cancelled = true;
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
    }

    async refreshResponses () {

        const auth = {
            signature: await this.services.safe.signMessage('Request owner invocation'),
            userAddress: this.services.safe.getSignerAddress()
        }

        const response = await fetch(`${BACKENDURL}/api/surveys/${this.surveyId}/results`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                auth,
                queryIds: this.survey.queryIds,
                poolId: this.survey.pool,
                groups: this.survey.groups,
                poolConfig: this.pool.config 
            })
        });

        console.log(response);

        // const talliedResults = await response.json();

        // this.survey.results = talliedResults.results;

        // if (this.cancelled) return;  

        // console.log("RESULTS", this.survey.results)
        // store.addSurvey(this.survey);
    }

    setListeners() {

        document.querySelector('#back-btn')?.addEventListener('click', () => {
            router.navigate('/surveys');
        });

        // Use event delegation on the parent container
        document.querySelector('#tabs-container')?.addEventListener('click', (e) => {
            const tab = (e.target as HTMLElement).closest('.tab');
            if (!tab) return;
            
            const tabName = (tab as HTMLElement).dataset.tab as 'results' | 'access' | 'questions';
            store.setUI({ resultTab: tabName });
        });

        document.querySelector('#btn-forget')?.addEventListener('click', () => {
            store.forgetSurvey(this.surveyId);
            router.navigate("/surveys")
        });

        document.querySelector('#btn-copy')?.addEventListener('click', () => {

            const original = store.surveys.find( s => s.id === this.surveyId);
            if (!original) return;

            store.updateSurveyDraft({
                title: `${original.title} (copy)`,
                pool: original.pool,
                introduction: original.introduction,
                groups: structuredClone(original.groups),
                batches: [],           
            });

            store.setUI({ newStep: 'intro' });
            router.navigate("/new")
        });


        // document.addEventListener('batch-create', async (e) => {
        //     const event = e as CustomEvent
        //     const { batch, index, surveyId } = event.detail;

        //     console.log(batch, surveyId)

        //     const b = await createBatch(this.services, batch, poolId, surveyId)

        //     const receipt = await this.services.safe.write(surveyStore.address, surveyStore.abi, 'registerBatch', [poolId, b.id], { waitForReceipt: true});
        //     console.log(receipt);

        //     await createInvitations(b);
            
        // })

        // document.addEventListener('add-co-organiser', async (e: Event) => {
        //     const { address, role, surveyId } = (e as CustomEvent).detail;

        //     if (role == 'owner') {
        //         await this.services.safe.addOwner(address);
        //     }
        // });

        document.addEventListener('refresh-responses', async (e: Event) => {

            await this.refreshResponses()
        });

        document.addEventListener('survey-save', async (e: Event) => {
            const { surveyId, groups } = (e as CustomEvent).detail

            await this.services.safe.connectToExistingSafe(this.pool.config?.safe || "");

            // old state !
            const existing = store.surveys.find((s: any) => s.id === surveyId)
            if (existing) {

                const surveyConfig: Survey = { 
                    ...existing,
                    groups: groups
                };

                console.log("UPDATING WITH THIS", surveyConfig)
        
                let res: any = await fetch(`${BACKENDURL}/api/surveys/${surveyId}`, {
                    method: 'PUT',
                    headers: {
                    'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({   
                        surveyId,      
                        surveyConfig,
                        safeAddress: this.pool.config?.safe,
                        poolId: existing.pool
                    })
                });

                const result = JSON.parse(await res.text());

                if (this.services.ipfs.isCID(result.cid)) {

                    const args = [surveyId, result.cid.toString()];

                    const receipt = await this.services.safe.write(surveyStore.address, surveyStore.abi, 'updateSurvey', args, { waitForReceipt: true});
                    console.log(receipt);

                    store.addSurvey(surveyConfig)

                } else {

                    console.log("IPFS upload failed", result.cid)
                }
            }

            console.log('save groups', surveyId, groups)
        });
    }
}