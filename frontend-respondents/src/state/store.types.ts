import { CardState } from '../controllers/landing.ctrlr.js';

export interface UserState {
    nullifier: string | null;
    batchId: string | null;
    address: string | null;
}

// View-state for the active survey-answering session. NOTE: this is NOT a
// Survey variant — it was previously misnamed `SurveyState`, which was a trap.
// It tracks which survey is active and which question indices have been
// answered so far; the actual Survey payload lives in SurveysStore entries.
export interface SurveyAnswerState {
    surveyId: string | null;
    questions: number[];
    cardState?: CardState;
}

export type CardView = 'validation' | 'nocard' | 'blocked' | 'survey' | 'welcomeback' | 'login';

export interface UIState {
    cardView: CardView;
}
