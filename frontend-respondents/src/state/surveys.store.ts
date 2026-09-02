import { Observable, Listener } from './observable.js';
import { Survey, SurveyEntry, SurveyMap } from '@s3ntiment/shared';
import { loadSurveysFromStorage, saveSurveysToStorage, clearSurveysFromStorage } from './storage.js';

export class SurveysStore {
  private observable: Observable<SurveyMap>;
  private _activeSurveyId: string | null = null;

  constructor() {
    this.observable = new Observable<SurveyMap>(loadSurveysFromStorage());
  }

  get all(): SurveyMap {
    return this.observable.get();
  }

  get activeSurveyId(): string | null {
    return this._activeSurveyId;
  }

  get active(): SurveyEntry | null {
    if (!this._activeSurveyId) return null;
    return this.all[this._activeSurveyId] ?? null;
  }

  setActive(surveyId: string): void {
    this._activeSurveyId = surveyId;
    if (!this.all[surveyId]) {
      this.observable.update(current => ({
        ...current,
        [surveyId]: { id: surveyId, answeredQuestions: [] },
      }));
    }
  }

  setData(surveyId: string, data: Survey): void {
    this.observable.update(current => ({
      ...current,
      [surveyId]: { ...current[surveyId], ...data, id: surveyId },
    }));
  }

  getData(surveyId: string): SurveyEntry | null {
    return this.all[surveyId] ?? null;
  }

  update(surveyId: string, update: Partial<Omit<SurveyEntry, 'id'>>): void {
    this.observable.update(current => ({
      ...current,
      [surveyId]: { ...current[surveyId], ...update, id: surveyId },
    }));
  }

  get(surveyId: string): SurveyEntry | null {
    return this.all[surveyId] ?? null;
  }

  subscribe(listener: Listener<SurveyMap>): () => void {
    return this.observable.subscribe(listener);
  }

  persist(): void {
    const stripped = Object.fromEntries(
      Object.entries(this.all).map(([k, v]) => {
        const { groups, batches, config, title, introduction, ...rest } = v;
        return [k, rest];
      })
    );
    saveSurveysToStorage(stripped as SurveyMap);
  }

  clear(surveyId?: string): void {
    if (surveyId) {
      this.observable.update(current => {
        const next = { ...current };
        delete next[surveyId];
        return next;
      });
      this.persist();
    } else {
      this.observable.set({});
      this._activeSurveyId = null;
      clearSurveysFromStorage();
    }
  }
}