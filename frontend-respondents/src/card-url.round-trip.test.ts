import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

// Round-trip seam: reproduce the ORGANISER's producer shape
// (frontend-organiser/src/factories/invitation.factory.ts `generateCardSecrets`
// builds `` `${BASEURL}?n=${nullifier}&b=${batch.id}&sig=${signature}&s=${batch.survey}` ``)
// and feed it to the SHARED consumer `parseCardURL`. This closes the
// producer/consumer handshake without needing organiser vitest infra — the
// recovered surveyOwner must equal the batchId the card was signed for (the
// exact condition on-chain registerInPool and the auth flow rely on).

// Shared seam, imported by DIRECT RELATIVE SOURCE PATH (mirrors the
// card-signature.seam precedent): the shared .ts source, never the unbuilt dist.
import { signCardMessage } from '../../shared/src/shared/invites/encoding.js';
import { parseCardURL } from '../../shared/src/shared/invites/card.factory.js';
import type { CardData } from '../../shared/src/shared/invites/types.js';

const BATCH_PK =
  '0x00000000000000000000000000000000000000000000000000000000000000aa';
const batchOwner = privateKeyToAccount(BATCH_PK);

const SURVEY_ID = 'survey-roundtrip';
// BASEURL stands in for the app base URL the organiser resolves at build time
// (import.meta.env.VITE_FRONTEND_DEV / _PROD). The path/host are irrelevant to
// parseCardURL — it only reads the query string.
const BASEURL = 'https://respondent.example.com/';

// Mirrors invitation.factory.ts `generateRandomNullifier()`: 16 random bytes,
// base64url-encoded with padding stripped.
function generateGeneratedNullifier(): string {
  // node >=18 exposes the web Crypto getRandomValues + btoa globals.
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  return btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

describe('organiser producer -> shared parseCardURL round-trip', () => {
  it('recovers surveyOwner === batchId for a card generated exactly like the organiser does', async () => {
    const nullifier = generateGeneratedNullifier();
    const signature = await signCardMessage(batchOwner, nullifier, batchOwner.address);

    // Identical assembly to invitation.factory.ts generateCardSecrets.
    const url = `${BASEURL}?n=${nullifier}&b=${batchOwner.address}&sig=${signature}&s=${SURVEY_ID}`;

    const data = await parseCardURL(url);

    expect(data).not.toBeNull();
    const card = data as CardData;
    // The recovered survey owner IS the batchId that signed the card — the
    // exact equality registerInPool / the auth flow enforce on-chain.
    expect(card.surveyOwner).toBe(batchOwner.address);
    expect(card.nullifier).toBe(nullifier);
    expect(card.batchId).toBe(batchOwner.address);
    expect(card.surveyId).toBe(SURVEY_ID);
  });

  it('round-trips even with an encodeURIComponent-escaped nullifier in the query', async () => {
    const nullifier = generateGeneratedNullifier();
    const signature = await signCardMessage(batchOwner, nullifier, batchOwner.address);

    const url =
      `${BASEURL}?n=${encodeURIComponent(nullifier)}` +
      `&b=${batchOwner.address}&sig=${signature}&s=${SURVEY_ID}`;

    const data = await parseCardURL(url);

    expect(data).not.toBeNull();
    const card = data as CardData;
    expect(card.surveyOwner).toBe(batchOwner.address);
    expect(card.nullifier).toBe(nullifier);
  });

  it('multiple cards from one batch all recover to the same batchId', async () => {
    const cards = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const nullifier = generateGeneratedNullifier();
        const signature = await signCardMessage(batchOwner, nullifier, batchOwner.address);
        const url = `${BASEURL}?n=${nullifier}&b=${batchOwner.address}&sig=${signature}&s=${SURVEY_ID}`;
        return parseCardURL(url);
      }),
    );

    for (const data of cards) {
      expect(data).not.toBeNull();
      expect((data as CardData).surveyOwner).toBe(batchOwner.address);
    }
  });
});
