import { typograhyStyles } from '@s3ntiment/shared/assets'
import { buttonStyles } from '@s3ntiment/shared/assets'
import { layoutStyles } from '@s3ntiment/shared/assets'
import { store } from '../state/index.js'
import './survey-forms/survey-form-intro.js'
import './survey-forms/survey-form-questions.js'
import './survey-forms/pool-form-batches.js'

type Step = 'intro' | 'questions' | 'batches' | 'creating-pool' | 'register-pool' | 'creating-survey' | 'creating-invites' | 'submitting-tx' | 'error'

class DraftSurveyEditor extends HTMLElement {
    private unsubscribeUI: (() => void) | null = null
    private unsubscribeDraft: (() => void) | null = null
    private currentStep: Step = 'intro'
    private isInternalUpdate: boolean = false

    constructor() {
        super()
        this.attachShadow({ mode: 'open' })
        this.shadowRoot!.adoptedStyleSheets = [typograhyStyles, buttonStyles, layoutStyles]
    }

    connectedCallback() {
        this.currentStep = store.ui.newStep
        this.render()
        this.attachEventListeners()
        this.loadDraftIntoForms()

        // Subscribe to UI changes for step navigation
        this.unsubscribeUI = store.subscribeUI((ui) => {
            if (ui.newStep !== this.currentStep) {
                this.currentStep = ui.newStep
                this.render()
                this.attachEventListeners()
                this.loadDraftIntoForms()
            }
        })

        // Subscribe to draft changes (e.g., when loading a different draft)
        // Skip if we caused the update ourselves
        this.unsubscribeDraft = store.subscribeSurveyDraft(() => {
            if (!this.isInternalUpdate) {
                this.loadDraftIntoForms()
            }
        })
    }

    disconnectedCallback() {
        if (this.unsubscribeUI) {
            this.unsubscribeUI()
            this.unsubscribeUI = null
        }
        if (this.unsubscribeDraft) {
            this.unsubscribeDraft()
            this.unsubscribeDraft = null
        }
    }

    private updateStore(updates: Record<string, any>) {
        this.isInternalUpdate = true
        store.updateSurveyDraft(updates)
        // Reset flag after a short delay to catch all sync subscriber notifications
        setTimeout(() => {
            this.isInternalUpdate = false
        }, 0)
    }

    private loadDraftIntoForms() {
        const draft: any = store.surveyDraft

        if (this.currentStep === 'intro') {
            const introForm = this.shadowRoot?.querySelector('survey-form-intro') as any
            if (introForm) {
                introForm.surveyTitle = draft.title || ''
                introForm.introduction = draft.introduction || ''
            }
        } else if (this.currentStep === 'questions') {
            const questionsForm = this.shadowRoot?.querySelector('survey-form-questions') as any
            if (questionsForm) {
                questionsForm.groups = draft.groups || []
            }
        } else if (this.currentStep === 'batches') {
            const batchesForm = this.shadowRoot?.querySelector('survey-form-batches') as any
            if (batchesForm) {
                batchesForm.batches = draft.batches || []
            }
        }
    }

    private render() {
        if (!this.shadowRoot) return

        this.shadowRoot.innerHTML = `
        <style>
            :host {
                display: block;
            }

            .editor-container {
                width: 100%;
            }

            .form-actions {
                display: flex;
                gap: 1rem;
                padding: 1.5rem;
            }

            .action-container {
            }
        </style>

        <div class="editor-container container container-large centered">
            ${this.renderStep()}
           
        </div>
        <div class="action-container container centered">
            <div class="container container-large centered">
                ${this.renderActions()}
            </div>
        </div>
        `
    }

    private renderStep(): string {
        switch (this.currentStep) {
            case 'intro':
                return `<survey-form-intro class="container"></survey-form-intro>`
            case 'questions':
                return `<survey-form-questions class="container"></survey-form-questions>`
            case 'batches':
                return `<pool-form-batches mode="draft" class="container"></pool-form-batches>`
            case 'creating-pool':
                return `<loading-spinner message='creating pool'></loading-spinner>`
            case 'register-pool':
                return `<loading-spinner message='registering pool'></loading-spinner>`
            case 'creating-survey':
                return `<loading-spinner message='creating survey'></loading-spinner>`
            case 'creating-invites':
                return `<loading-spinner message='creating invites'></loading-spinner>`
            case 'error':
                return `something went horribly wrong`
            default:
                return ''
        }
    }

    private renderActions(): string {
        switch (this.currentStep) {
            case 'intro':
                return `
                    <div class="form-actions">
                        <button class="btn-secondary" id="next-btn">Next ></button>
                    </div>
                `
            case 'questions':
                return `
                    <div class="form-actions">
                        <button class="btn-secondary" id="back-btn">< Back</button>
                        ${this.isNewPool
                            ? `<button class="btn-secondary" id="next-btn">Next ></button>`
                            : `<button class="btn-primary" id="submit-btn">Create Survey</button>`
                        }
                    </div>
                `
            case 'batches':
                return `
                    <div class="form-actions">
                        <button class="btn-secondary" id="back-btn">< Back</button>
                        <button class="btn-primary" id="submit-btn">Create Survey</button>
                    </div>
                `
            default:
                return ''
        }
    }

    private attachEventListeners() {
        // Form change events - intro
        this.shadowRoot?.addEventListener('title-change', ((e: CustomEvent) => {
            this.updateStore({ title: e.detail.value })
        }) as EventListener)

        this.shadowRoot?.addEventListener('pool-change', ((e: CustomEvent) => {
            this.updateStore({ pool: e.detail.value })
        }) as EventListener)

        this.shadowRoot?.addEventListener('introduction-change', ((e: CustomEvent) => {
            this.updateStore({ introduction: e.detail.value })
        }) as EventListener)

        // Form change events - questions
        this.shadowRoot?.addEventListener('groups-change', ((e: CustomEvent) => {
            this.updateStore({ groups: e.detail.value })
        }) as EventListener)

        // Form change events - batches
        this.shadowRoot?.addEventListener('batches-change', ((e: CustomEvent) => {
            this.updateStore({ batches: e.detail.value })
        }) as EventListener)

        // Navigation
        this.shadowRoot?.querySelector('#back-btn')?.addEventListener('click', () => {
            this.goBack()
        })

        this.shadowRoot?.querySelector('#next-btn')?.addEventListener('click', () => {
            this.goNext()
        })

        this.shadowRoot?.querySelector('#submit-btn')?.addEventListener('click', () => {
            this.submit()
        })
    }

    private get isNewPool(): boolean {
        return !store.surveyDraft.pool;
    }

    private goBack() {
        switch (this.currentStep) {
            case 'questions':
                store.setUI({ newStep: 'intro' })
                break
            case 'batches':
                store.setUI({ newStep: 'questions' })
                break
        }
    }

    private goNext() {
        switch (this.currentStep) {
            case 'intro':
                if (this.validateIntro()) {
                    store.setUI({ newStep: 'questions' })
                }
                break
            case 'questions':
                if (this.validateQuestions()) {
                    if (this.isNewPool) {
                        store.setUI({ newStep: 'batches' })
                    } else {
                        this.submit()
                    }
                }
                break
        }
    }

    private validateIntro(): boolean {
        const draft = store.surveyDraft
        if (!draft.title?.trim()) {
            alert('Please enter a survey title')
            return false
        }
        return true
    }

    private validateQuestions(): boolean {
        const questionsForm = this.shadowRoot?.querySelector('survey-form-questions') as any
        if (questionsForm) {
            const errors = questionsForm.validate()
            if (errors.length > 0) {
                alert(`Please fix:\n${errors.join('\n')}`)
                return false
            }
        }
        return true
    }

    private validateBatches(): boolean {
        const batchesForm = this.shadowRoot?.querySelector('survey-form-batches') as any
        if (batchesForm) {
            const errors = batchesForm.validate()
            if (errors.length > 0) {
                alert(`Please fix:\n${errors.join('\n')}`)
                return false
            }
        }
        return true
    }

    private submit() {
        if (!this.validateBatches()) {
            return
        }

        const btn = this.shadowRoot?.querySelector('#submit-btn') as HTMLButtonElement;
        if (btn) btn.disabled = true;

        const draft = store.surveyDraft

        // Dispatch event for parent to handle submission
        this.dispatchEvent(new CustomEvent('survey-submit', {
            detail: { survey: draft },
            bubbles: true,
            composed: true
        }))
    }
}

customElements.define('draft-survey-editor', DraftSurveyEditor)

export { DraftSurveyEditor }