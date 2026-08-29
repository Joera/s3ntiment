// src/router.gates.ts
//
// Pure decision logic for the two Navigo `before` entry gates, extracted from
// router.ts so the decision paths can be unit-tested in the Node vitest runner
// without a DOM or Navigo harness. These helpers NEVER touch `window`,
// `document` or the router itself — they return a discriminated result that the
// caller (initRouter) turns into a navigation + done().
//
// The extraction preserves the exact observable router behavior (root: card
// unparseable -> invalid-card; used -> used-card/:surveyId; else proceed;
// /surveys: fetchSurvey -> participation/authenticate -> proceed | invalid-card),
// while making the gate logic independently testable.

import { Card, type CardData } from '../../shared/src/shared/invites/card.factory.js';
import { fetchSurvey } from '@s3ntiment/shared/browser';
import { authenticate, hasParticipatingAccount } from './auth.factory.js';
import { store } from './state/store.js';

export type RootGateResult =
  | { navigate: string } // '/invalid-card' or '/used-card/:surveyId'
  | { proceed: true };

export type SurveyGateResult =
  | { navigate: string } // '/surveys' or '/invalid-card'
  | { proceed: true };

// Root `/` entry gate. `cardData` is the already-parsed card (from
// parseCardURL(window.location.href) by the caller); it may be null when the
// URL is unparseable / missing params.
export async function resolveRootGate(
  services: any,
  cardData: CardData | null,
  surveyStore: any,
): Promise<RootGateResult> {
  if (cardData == null) {
    return { navigate: '/invalid-card' };
  }

  const card = new Card(cardData);

  // card-v2: isNullifierUsed is scoped per pool, so the usage check needs the
  // poolId. The card URL only carries the surveyId (not the pool), so resolve
  // the pool via the survey before checking — the pool is otherwise unknown at
  // the root gate. If it can't be resolved, proceed conservatively (usage is
  // re-checked later in the flow).
  let poolId: string | undefined;
  if (cardData.surveyId) {
    const [, resolvedPool] = await fetchSurvey(services, surveyStore, cardData.surveyId);
    poolId = resolvedPool;
  }
  if (!poolId) {
    return { proceed: true };
  }

  const isUsed = await card.isUsed(services, surveyStore, poolId);

  if (isUsed) {
    return { navigate: `/used-card/${card.surveyId}` };
  }
  return { proceed: true };
}

// `/surveys/:surveyId` entry gate. Resolves the surveyId (navigating to
// '/surveys' when absent), fetches the survey and populates the store, then
// grants entry only to participating accounts (authenticating on demand).
export async function resolveSurveyGate(
  services: any,
  surveyStore: any,
  surveyId: string,
): Promise<SurveyGateResult> {
  if (!surveyId) {
    return { navigate: '/surveys' };
  }

  const [, poolId] = await fetchSurvey(services, surveyStore, surveyId);

  store.setSurveyData(surveyId, {
    id: surveyId,
    pool: poolId,
  });
  store.setActiveSurvey(surveyId);

  let isParticipant = await hasParticipatingAccount(services, poolId);
  if (!isParticipant) {
    isParticipant = await authenticate(services, poolId);
  }

  if (isParticipant) {
    return { proceed: true };
  }
  return { navigate: '/invalid-card' };
}
