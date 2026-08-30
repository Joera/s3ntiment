
import { IServices } from "../services/services.js";
import { store } from "../state/store.js";
import { reactive } from "../utils/reactive.js";
import '../components/survey-detail-responses.js';
import '../components/pool-detail-access.js';
// import '../components/survey-forms/survey-form-questions.js';
import '../components/survey-forms/pool-form-batches.js';
import '../components/registered-questions-editor.js';
import { router } from "../router.js";
import { createBatch } from "../factories/survey.factory.js";
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import {  fetchAndDecryptSurveyWithOwner, Pool, Survey } from "@s3ntiment/shared";
import { renderIcon } from "@s3ntiment/shared/assets";
import '@s3ntiment/shared/components';
import { authenticate } from "../factories/auth.factory.js";
import { getPoolInfo } from "../factories/pool.factory.js";
import { PoolFormBatches } from "../components/survey-forms/pool-form-batches.js";


export class PoolController {
    private reactiveViews: any[] = [];
    private services: IServices;
    private poolId: string;
    private pool!: Pool;

    constructor(services: IServices, poolId: string) {

        this.services = services;
        this.poolId = poolId;
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        if (!app) return;

        app.innerHTML = `
            <style>
           
                .pool-header {
                    width: 100%;
                    display: flex;
                    flex-direction: row;
                    justify-content: flex-start;
                    align-items: center;
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

                .forget-container {
                    margin: 3rem 1.5rem;
                    borer-top: 1px solid var(--color-too-dark);
                }

            </style>

            <div class="container container-large">
                <div class="pool-header">
                    <button class="back-btn" id="back-btn">${renderIcon('caret')}</button>
                    <h2 id="pool-title">Loading...</h2>
                </div>

                <div class="tabs-container">
                    <div class="tabs" id="tabs-container"></div>
                </div>

                <div id="pool-container" class="container container-large centered"></div>

                <div class="forget-container">
                    <button class="btn-primary" id="btn-forget">Forget</button>
                </div>
            </div>
        `;

        // Reactive survey title
        const titleView = reactive('#pool-title', () => {

            console.log("should update", this.pool)
            return this.pool?.name || '...';
        });
``
        if (titleView) {
            titleView.bind('pools');
            this.reactiveViews.push(titleView);
        }

        // Reactive tabs active state
        const tabsView = reactive('#tabs-container', () => {
            const { resultTab } = store.ui;
            
            return `
                <button class="tab ${resultTab === 'access' ? 'active' : ''}" data-tab="access">Access</button>
                <button class="tab ${resultTab === 'batches' ? 'active' : ''}" data-tab="batches">Batches</button>
                <button class="tab"></button>
            `;
        });

        if (tabsView) {
            tabsView.bind('ui');
            this.reactiveViews.push(tabsView);
        }

        // Reactive survey content
        const view = reactive('#pool-container', () => {
            const { resultTab } = store.ui;

            switch (resultTab) {
                case 'spinner':
                    return `<loading-spinner></loading-spinner>`
                case 'access':
                    return `<pool-detail-access class="container" pool-id="${this.poolId}"></pool-detail-access>`;
                case 'batches':
                    return `<pool-form-batches class="container" pool-id="${this.poolId}"></pool-form-batches>`;
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

        store.setUI({resultTab : "access"})

        let pool = store.pools.find((s: any) => s.id === this.poolId);

        console.log("POOL", pool, this.poolId)

        const _pool = await getPoolInfo(this.services, this.poolId)
        
        if (pool) {
            pool.owners = _pool.owners;
            store.addPool(pool)
        }

        if (pool && pool !== undefined) {
            this.pool = pool;
        } 

         // get batches on chain
         // get owners and readers on chain 

        await this.services.safe.connectToExistingSafe(this.pool.safeAddress || "") 
    }

    async render() {

        this.process();
        this.renderTemplate();
        
    }

    destroy() {
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
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
            console.log("click", tabName);
            store.setUI({ resultTab: tabName });
        });

        document.addEventListener('batch-create', async (e) => {
            const event = e as CustomEvent
            const { batch, index, poolId, surveyId } = event.detail;

            console.log(batch, poolId)

            const b = await createBatch(this.services, batch, poolId, surveyId)

            const receipt = await this.services.safe.write(surveyStore.address, surveyStore.abi, 'registerBatch', [poolId, b.id], { waitForReceipt: true});
            console.log(receipt);

            store.addBatch(b);

            // await createInvitations(b);

            const el = document.querySelector('pool-form-batches') as PoolFormBatches;
            el?.refreshBatches();
            
        })

        document.addEventListener('add-co-organiser', async (e: Event) => {
            const { address, role, surveyId } = (e as CustomEvent).detail;

            if (role == 'owner') {

                const isOwnerAbi = [{
                    name: 'isOwner',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: 'owner', type: 'address' }],
                    outputs: [{ name: '', type: 'bool' }]
                }] as const

                const isAlreadyOwner = await this.services.viem.read(this.services.safe.getAddress() || "0x", isOwnerAbi, "isOwner", [address]);

                if (isAlreadyOwner) {
                    console.log('Already an owner, skipping addOwner')
                    return
                }
                
                await this.services.safe.addOwner(address);
            }
        });

        document?.querySelector('#btn-forget')?.addEventListener('click', () => {
            store.forgetPool(this.poolId);
            router.navigate("/surveys")
        });

    }
}