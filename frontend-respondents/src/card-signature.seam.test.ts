import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress, keccak256, concat, stringToBytes, toBytes } from 'viem';

// Shared card-encoding seam, imported by DIRECT RELATIVE SOURCE PATH
// (mirroring src/auth.factory.ts's `../../shared/src/shared` precedent) so the
// test depends on the shared .ts source, never the unbuilt dist.
import {
  cardMessageHash,
  ethSignedMessageHash,
  signCardMessage,
} from '../../shared/src/shared/invites/encoding.js';

// Real shared parseCardURL — it uses cardMessageHash + recoverMessageAddress to
// recover the survey owner from the card signature, the exact round-trip the
// respondent auth flow (Card.register -> on-chain registerInPool) relies on.
import { parseCardURL } from '../../shared/src/shared/invites/card.factory.js';
import type { CardData } from '../../shared/src/shared/invites/types.js';

// Deterministic test identity (20-byte address) doubles as the batchId.
const BATCH_PK =
  '0x00000000000000000000000000000000000000000000000000000000000000aa';
const batchOwner = privateKeyToAccount(BATCH_PK);
const batchId = batchOwner.address;

const NULLIFIER = 'respondent-123';

describe('shared card-encoding seam (imported by relative source path)', () => {
  it('cardMessageHash matches the on-chain digest scheme', () => {
    const digest = cardMessageHash(NULLIFIER, batchId);
    // keccak256(abi.encodePacked(nullifier, "|", batchId))
    const expected = keccak256(
      // encoded bytes: utf8(nullifier) ++ "|" ++ batchId as 20 bytes
      concat([
        stringToBytes(NULLIFIER),
        stringToBytes('|'),
        toBytes(batchId),
      ]),
    );
    expect(digest).toBe(expected);
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('ethSignedMessageHash wraps the digest in the EIP-191 personal-sign envelope', () => {
    const digest = cardMessageHash(NULLIFIER, batchId);
    const signedHash = ethSignedMessageHash(digest);
    const expected = keccak256(
      concat([stringToBytes('\x19Ethereum Signed Message:\n32'), toBytes(digest)]),
    );
    expect(signedHash).toBe(expected);
  });

  it('signCardMessage -> recoverMessageAddress round-trips to the batchId (card-signature -> owner recovery)', async () => {
    const digest = cardMessageHash(NULLIFIER, batchId);
    const signature = await signCardMessage(batchOwner, NULLIFIER, batchId);

    // This is exactly what on-chain registerInPool and shared parseCardURL do:
    // recover the signer from the ethSigned digest and require it == batchId.
    const recovered = await recoverMessageAddress({
      message: { raw: digest },
      signature,
    });

    expect(recovered).toBe(batchId);
  });

  it('parseCardURL recovers the survey owner from a signed card URL (auth flow entry point)', async () => {
    const signature = await signCardMessage(batchOwner, NULLIFIER, batchId);
    const surveyId = 'survey-roundtrip';

    const href = `http://respondent.local/?n=${NULLIFIER}&b=${batchId}&sig=${signature}&s=${surveyId}`;
    const data = await parseCardURL(href);

    expect(data).not.toBeNull();
    const card = data as CardData;
    expect(card.nullifier).toBe(NULLIFIER);
    expect(card.batchId).toBe(batchId);
    expect(card.surveyId).toBe(surveyId);
    // recovered survey owner == the batchId card was signed by
    expect(card.surveyOwner).toBe(batchId);
  });

  it('returns null for a card URL missing required params', async () => {
    const href = 'http://respondent.local/?n=onlynullifier';
    await expect(parseCardURL(href)).resolves.toBeNull();
  });
});
