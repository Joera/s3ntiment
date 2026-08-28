import { UIStore } from './ui.store.js';
import { UserStore } from './user.store.js';
import { SurveysStore, SurveyEntry, SurveyMap } from './surveys.store.js';
import { UIState, UserState } from './store.types.js';
import { Listener } from './observable.js';
import { Pool, Survey } from '@s3ntiment/shared';
import { PoolStore } from './pool.store.js';

class Store {
  private uiStore: UIStore;
  private userStore: UserStore;
  private surveysStore: SurveysStore;
  private poolStore: PoolStore;

  constructor() {
    this.uiStore = new UIStore();
    this.userStore = new UserStore();
    this.surveysStore = new SurveysStore();
    this.poolStore = new PoolStore();

  }

    get ui$() { return this.uiStore; }
    get user$() { return this.userStore; }
    get surveys$() { return this.surveysStore; }

    // ============ UI ============
    get ui(): UIState                          { return this.uiStore.state; }
    get cardView(): UIState['cardView']        { return this.uiStore.cardView; }
    setUI(update: Partial<UIState>): void      { this.uiStore.set(update); }
    resetUI(): void                            { this.uiStore.reset(); }
    subscribeUI(listener: Listener<UIState>)   { return this.uiStore.subscribe(listener); }

    // ============ User ============
    get user(): UserState                      { return this.userStore.state; }
    get nullifier()                            { return this.userStore.nullifier; }
    get batchId()                              { return this.userStore.batchId; }
    get address()                              { return this.userStore.address; }
    setUser(update: Partial<UserState>): void  { this.userStore.set(update); }
    persistUser(): void                        { this.userStore.persist(); }
    clearUser(): void                          { this.userStore.clear(); }
    subscribeUser(listener: Listener<UserState>) { return this.userStore.subscribe(listener); }

    // ============ Surveys ============
    get surveys(): SurveyMap                   { return this.surveysStore.all; }
    get activeSurveyId(): string | null        { return this.surveysStore.activeSurveyId; }
    get activeSurvey(): SurveyEntry | null     { return this.surveysStore.active; }
    setActiveSurvey(surveyId: string): void    { this.surveysStore.setActive(surveyId); }
    setSurveyData(surveyId: string, data: Survey): void { this.surveysStore.setData(surveyId, data); }
    getSurveyData(surveyId: string)            { return this.surveysStore.getData(surveyId); }
    updateSurvey(surveyId: string, update: Partial<Omit<SurveyEntry, 'id'>>): void { this.surveysStore.update(surveyId, update); }
    persistSurveys(): void                     { this.surveysStore.persist(); }
    clearSurvey(surveyId?: string): void       { this.surveysStore.clear(surveyId); }
    subscribeSurveys(listener: Listener<SurveyMap>) { return this.surveysStore.subscribe(listener); }


  // ============ Global ============
  clear(): void {
      this.uiStore.reset();
      this.userStore.clear();
      this.surveysStore.clear();
  }

  getPool(id: string): Pool | undefined { return this.poolStore.get(id); }
}

export const store = new Store();