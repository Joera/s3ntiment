
import { IServices } from "../services/services.js";
import { store } from "../state/store.js";
import { reactive } from "../utils/reactive.js";

import { router } from "../router.js";
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import {  Batch, Card, CardData, Pool, Survey } from "@s3ntiment/shared";
import '@s3ntiment/shared/components';
import { createCsvFile, createZipFile } from "../factories/invitation.factory.js";

export class BatchController {
    private reactiveViews: any[] = [];
    private unsubscribes: (() => void)[] = [];
    private services: IServices;
    private poolId: string;
    private batchId: string;
    private pool!: Pool;
    private batch!: Batch;
    

    constructor(services: IServices, poolId: string, batchId: string) {
        this.services = services;
        this.poolId = poolId;
        this.batchId = batchId;
    }

    private renderTemplate() {
        const app = document.querySelector('#app');
        if (!app) return;

        app.innerHTML = `
            <style>
                .actions-container {
                    margin: 1.5rem 0;
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

                #batch-container {
                
                    flex-direction: row;
                    flex-wrap: wrap;
                    gap: 1rem;
                    margin: 1.5rem;
                    width: calc(100% - 3rem);

                }

                .card svg {
                    width: 100%;
                    height: auto;
                }

                .card.used {
                    opacity: .1
                }

                .url {
                    width: 100%;
                }


            </style>

            <div class="container container-large centered">

                <div class="tabs-container">
                    <div class="tabs" id="tabs-container"></div>
                </div>

                <div id="batch-container" class="container container-large centered"></div>

                <div class="actions-container">
                    <button class="btn-primary" id="btn-refresh">Refresh</button>
                    <button class="btn-primary" id="btn-download">Download</button>
                </div>

            </div>
        `;

        const tabsView = reactive('#tabs-container', () => {
            const { batchTab } = store.ui;
            return `
                <button class="tab ${batchTab === 'qr-codes' ? 'active' : ''}" data-tab="qr-codes">QR</button>
                <button class="tab ${batchTab === 'ipfs' ? 'active' : ''}" data-tab="ipfs">IPFS</button>
                <button class="tab ${batchTab === 'urls' ? 'active' : ''}" data-tab="urls">URLs</button>
            `;
        });

        if (tabsView) {
            tabsView.bind('ui');
            this.reactiveViews.push(tabsView);
        }

        const view = reactive('#batch-container', () => {
            const { batchTab } = store.ui;

            switch (batchTab) {
                case 'qr-codes':
                    return this.batch?.cards
                        ? this.batch.cards.map((c: CardData) => {
                            const svg = c.svgString?.replaceAll("500","280")
                            return `<div class="card${c.isUsed ? ' used' : ''}">${svg}</div>`
                        }).join('')
                        : `<loading-spinner></loading-spinner>`;
                    break;
                case 'ipfs':
                    return this.batch?.cards
                        ? this.batch.cards.map((c: CardData) =>
                            `<div class="url ${c.isUsed ? 'used' : ''}"><copy-link value="${import.meta.env.VITE_PINATA_GATEWAY}/ipfs/${c.ipfsCid}" ${c.isUsed ? 'used' : ''}></copy-link></div>`
                        ).join('')
                        : `<loading-spinner></loading-spinner>`;
                    break;
                case 'urls':
                    // console.log(this.batch?.cards);
                    return this.batch?.cards
                        ? this.batch.cards.map((c: CardData) =>
                            `<div class="url"><copy-link value="${c.url}" ${c.isUsed ? 'used' : ''}></copy-link></div>`
                        ).join('')
                        : `<loading-spinner></loading-spinner>`;
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
        store.setUI({ batchTab: 'qr-codes' });

        const p = store.getPool(this.poolId);
        if (p) this.pool = p;
        const b = store.getBatch(this.batchId);
        if (b) {
            this.batch = b;
        } else {
            const bb = p?.batches.filter((b: any) => typeof b == 'object').find((b: any) => b.id == this.batchId);
            if (typeof bb === 'object' && 'id' in bb) this.batch = bb;
        }

        this.discardUsedCards();
    }

    async discardUsedCards() {
        let changed = false;
        
        for (const c of this.batch.cards!) {
            c.batchId = this.batchId;
            c.isUsed = false;
            const card = new Card(c);
            try {
                const used = await card.isUsed(this.services, surveyStore);
                console.log('USED', used)
                if (used && !c.isUsed) {
                    c.isUsed = true;
                    changed = true;
                }
            } catch (e) {
                console.log(e);
            }
        }

        if (changed) {
            store.addBatch(this.batch);
        }
    }

    async render() {

        this.unsubscribes.push(
            store.subscribeBatches(() => {
                const updated = store.batches.find(b => b.id === this.batchId);
                if (updated) {
                    this.batch = updated;
                    this.renderTemplate();
                }
            })
        );

        this.process();
        this.renderTemplate();
    }

    destroy() {
        this.reactiveViews.forEach(view => view.destroy());
        this.reactiveViews = [];
        
        this.unsubscribes.forEach(unsub => unsub());
        this.unsubscribes = [];
    }

    tabName(e: any) {

        const tab = (e.target as HTMLElement).closest('.tab');

        if (!tab) return;
        return (tab as HTMLElement).dataset.tab as 'qr-codes' | 'ipfs' | 'urls';
    }

    setListeners() {

        document.querySelector('#back-btn')?.addEventListener('click', () => {
            router.navigate(`/pool/${this.poolId}`);
        });

        document.querySelector('#tabs-container')?.addEventListener('click', (e) => {
            const tabName = this.tabName(e)
            store.setUI({ batchTab: tabName });
        });

        document?.querySelector('#btn-refresh')?.addEventListener('click', () => {

            this.discardUsedCards();
        });

        document?.querySelector('#btn-download')?.addEventListener('click', async (e) => {
            
            const { batchTab } = store.ui;

            switch (batchTab) {

                case 'qr-codes' : 
                    await createZipFile(this.batch.cards || [], this.batch.id)
                break;

                case 'ipfs' : 
                    await createCsvFile(this.batch.cards?.map( (c: CardData) => import.meta.env.VITE_PINATA_GATEWAY + '/ipfs/' + c.ipfsCid!) || [], this.batch.id)
                break;

                case 'urls' :  
                    await createCsvFile(this.batch.cards?.map( (c: CardData) => c.url!) || [], this.batch.id)
                break;
            }

        });
    }

}