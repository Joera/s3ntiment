// src/controllers/account-ctrlr.ts
//
// `/account` — "secure your stealth account" (Task 2, RFC-deferred-identity-
// persistence §5.2 / §7.3 / §9.4). Replaces the earlier `/secure` idea. This is
// NOT a join flow: the respondent is already a pool member (bootstrap E at entry,
// PR #21). It is an opt-in, post-value step that rotates the transient bootstrap
// leaf `E` onto a durable derived leaf `S` derived from a human-wallet anchor, then
// persists S + an `anchor_address` flag so the SMC owner + nilDB owner move E -> S.
//
// One method (`secureWithEmailWallet`) implements BOTH first-time secure (S is new)
// and Case-2 recover/re-assign (S is already a member, we drop the orphan bootstrap
// leaf). In both cases `rotateMember(poolId, S, sigByOldLeaf)` atomically swaps the
// on-chain membership old->S; the nilDB E->S record migration + wipe + persist are
// identical. We NEVER re-register S (an already-member S would revert
// `AlreadyPoolMember`) — rotateMember is the registration seam (PR #24).
//
// CRITICAL SAFETY: `clearBootstrapKey()` (wipe E) and `saveAnchorAddressFromStorage`
// happen ONLY after the full rotate (on-chain rotateMember -> nilDB E->S migration)
// succeeds. If the nilDB migration errors we surface it and KEEP E (no wipe, no
// anchor) — we never orphan the answer.

import { reactive } from '../utils/reactive.js';
import '@s3ntiment/shared/components';
import { IServices } from '../services.js';
import { store } from '../state/store.js';
import { S3NTIMENT_STORE as surveyStore } from 's3ntiment-contracts/constants';
import { authenticate } from '../humanWallet.factory.js';
import {
  loadBootstrapKeyFromStorage,
  saveDerivedSKeyFromStorage,
  saveAnchorAddressFromStorage,
  clearBootstrapKey,
} from '../state/storage.js';
import { signRotateMessage, ROTATE_MEMBER_ABI } from '../rotate-member.signing.js';

const BACKENDURL =
  import.meta.env.VITE_PROD == "true"
    ? import.meta.env.VITE_BACKEND_PROD
    : import.meta.env.VITE_BACKEND_DEV;

export interface SecureResult {
  ok: boolean;
  reason?: string;
  anchor?: string;
  sAddress?: string;
}

export class AccountController {
  private reactiveViews: any[] = [];
  private services: IServices;
  private statusMessage = '';

  constructor(services: IServices) {
    this.services = services;
  }

  private renderTemplate() {
    const app = document.querySelector('#app');
    if (!app) return;

    app.innerHTML = `<div id="account-content" class="centered"></div>`;

    const view = reactive('#account-content', () => {
      const anchor = this.statusMessage;
      return `
        <div class="onboarding-message">
          <h2>Secure your stealth account</h2>
          <p>The keys for your stealth account are stored in this app. If you lose or reset this device, your account is permanently lost.</p>
          <p style="font-size:0.9rem;opacity:0.85">Choose how you'd like to keep access to your account. This helps you recover it — and your answers — on another device later.</p>
          <div id="account-options" style="display:flex;flex-direction:column;gap:0.75rem;margin-top:1.25rem">
            <div class="account-option">
              <label for="anchor-email"><strong>Email + human wallet</strong></label>
              <div style="display:flex;gap:0.5rem;margin-top:0.4rem">
                <input id="anchor-email" type="email" placeholder="you@example.com" style="flex:1" />
                <button id="secure-account-btn" class="btn-primary">Secure</button>
              </div>
            </div>
            <div class="account-option" style="opacity:0.5">
              <label><strong>Railgun</strong> <span class="coming-soon">coming soon</span></label>
            </div>
            <div class="account-option" style="opacity:0.5">
              <label><strong>Nihilium</strong> <span class="coming-soon">coming soon</span></label>
            </div>
          </div>
          ${anchor ? `<div id="account-status" class="account-status">${anchor}</div>` : ''}
        </div>
      `;
    });

    if (view) {
      view.bind(store.ui$);
      this.reactiveViews.push(view);
    }
  }

  async render() {
    this.renderTemplate();
    this.attachListeners();
  }

  destroy() {
    this.reactiveViews.forEach((view) => view.destroy());
    this.reactiveViews = [];
  }

  attachListeners() {
    const btn = document.getElementById('secure-account-btn');
    btn?.addEventListener('click', async () => {
      const emailInput = document.getElementById('anchor-email') as HTMLInputElement | null;
      const email = emailInput?.value?.trim();
      const poolId = store.activeSurvey?.pool;

      if (!email) {
        this.statusMessage = 'Please enter an email to secure your account.';
        this.renderTemplate();
        return;
      }
      if (!poolId) {
        this.statusMessage = 'No active survey pool — cannot secure right now.';
        this.renderTemplate();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Securing…';
      try {
        const result = await this.secureWithEmailWallet(email, poolId);
        this.statusMessage =
          result.ok
            ? 'Your stealth account is secured. Your keys for this pool now live with your human wallet — you can recover them on a new device.'
            : `We couldn't complete securing your account (${result.reason ?? 'unknown'}). Nothing was wiped — your existing access is unchanged. Please try again.`;
      } catch (e: any) {
        this.statusMessage = `We couldn't complete securing your account (${e?.message ?? e}). Nothing was wiped — your existing access is unchanged.`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Secure';
        this.renderTemplate();
      }
    });
  }

  /**
   * Secure (or recover) via the email + human-wallet option.
   *
   * Steps (each additive, matching repo patterns):
   *  1. Capture the acting bootstrap leaf `oldLeaf` (current SMC owner).
   *  2. Derive S via the refactored humanWallet factory (WaaP + OPRF) — returns the
   *     derived S key (persisted later) and swaps the signer to S internally.
   *  3. Re-establish the bootstrap leaf as signer so the rotateMember write is sent
   *     from the SMC whose owner is the old leaf, signed by the old leaf (EIP-191
   *     digest bound to poolId/oldLeaf/newLeaf/store/chain — see rotate-member.
   *     signing.ts). Call contract `rotateMember(poolId, S, signature)` through the
   *     funded Pimlico smart-account write path (RFC §7.3 second tx, paymaster-paid).
   *  4. Swap the signer to S (nilDB + SMC owner now resolve to S).
   *  5. Migrate the old leaf's nilDB records E -> S (two-client delete+recreate).
   *     FAIL-SAFE: if this errors, KEEP E — do NOT wipe, do NOT set anchor.
   *  6. Wipe bootstrapE, persist the derived S key, set the anchor_address flag.
   */
  async secureWithEmailWallet(email: string, poolId: string): Promise<SecureResult> {
    // 1) Acting bootstrap leaf (E / E2) — the current SMC owner at entry.
    const oldLeaf = this.services.account.getSignerAddress() as `0x${string}`;
    const bootstrapKey = loadBootstrapKeyFromStorage();
    if (!bootstrapKey) {
      return { ok: false, reason: 'no_bootstrap_key' };
    }

    // 2) Derive S (returns derived key + address; swaps signer to S internally).
    const derived = await authenticate(this.services, poolId);
    const sKey = derived.key;
    const sAddress = derived.address;
    const surveyId = store.activeSurvey?.id;

    // 3) Re-establish the old leaf to authorise + send the atomic E->S rotate.
    await this.services.account.updateSignerWithKey(bootstrapKey);
    const signer = this.services.account.getSigner() as {
      sign: (args: { hash: `0x${string}` }) => Promise<`0x${string}`>;
    };
    const signature = await signRotateMessage(signer, poolId, oldLeaf, sAddress, {
      storeAddress: surveyStore.address as `0x${string}`,
      chainId: BigInt(surveyStore.chainId ?? 8453),
    });

    const tx = await this.services.account.write(
      surveyStore.address,
      [...(surveyStore.abi as any[]), ROTATE_MEMBER_ABI],
      'rotateMember',
      [poolId, sAddress, signature],
      { waitForReceipt: true },
    );
    if (!(tx.receipt?.status === 'success')) {
      return { ok: false, reason: 'rotate_reverted' };
    }

    // 4) Swap signer to S — SMC owner + nilDB owner now resolve to S.
    await this.services.account.updateSignerWithKey(sKey);

    // 5) Migrate old-leaf records E -> S (delete under E, recreate under S).
    //    FAIL-SAFE: with no active survey we cannot confirm the record move, so we
    //    refuse to wipe E / set an anchor — we never orphan the answer.
    if (!surveyId) {
      return { ok: false, reason: 'no_active_survey' };
    }
    const migration = await this.migrateRecordsToDerivedLeaf(poolId, surveyId, sKey);
    // FAIL-SAFE: keep E — never wipe / never anchor on a failed migration.
    if (!migration.ok) {
      return { ok: false, reason: migration.reason };
    }

    // 6) Wipe E, persist S + anchor — ONLY reached on full success.
    clearBootstrapKey();
    saveDerivedSKeyFromStorage(sKey);
    saveAnchorAddressFromStorage(email);

    return { ok: true, anchor: email, sAddress };
  }

  /**
   * Cross-leaf nilDB record migration (E -> S) via two-client delete+recreate
   * (RFC §6 / §11 delete+recreate ownership move — no ACL wrapper exists in the
   * repo, so the record is re-created under the new leaf's owner did:key and the
   * old leaf's copy is deleted). One shared NillDBUserService is re-init'd
   * sequentially per leaf via `account.updateSignerWithKey` + `createNillDBSeed`
   * (the seed is a deterministic function of the acting leaf). Returns { ok:false }
   * on ANY error so the caller keeps the old leaf (fail-safe).
   */
  private async migrateRecordsToDerivedLeaf(
    poolId: string,
    surveyId: string,
    sKey: `0x${string}`,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      const bootstrapKey = loadBootstrapKeyFromStorage();
      if (!bootstrapKey) return { ok: false, reason: 'no_bootstrap_key' };

      // --- read + delete the old leaf's records (init under E) ---
      await this.services.account.updateSignerWithKey(bootstrapKey);
      const seedE = await this.services.account.createNillDBSeed();
      await this.services.nillDB.init(seedE);
      const records = await this.services.nillDB.listOwnedBySurvey(surveyId);

      for (const record of records) {
        const del = await this.services.nillDB.deleteOwnedData(
          surveyId,
          record.documentId,
          [record.data],
        );
        if (!del.ok) return { ok: false, reason: 'migration_delete_failed' };
      }

      // --- recreate under S (init under S) --- ALWAYS ends with S as the active
      // signer so the account resolves to S even when there were 0 records to move.
      await this.services.account.updateSignerWithKey(sKey);
      const seedS = await this.services.account.createNillDBSeed();
      await this.services.nillDB.init(seedS);

      if (records.length === 0) {
        // No old-leaf records to move; nothing further to do under S.
        return { ok: true };
      }

      const survey = store.activeSurvey as any;
      const poolConfig = survey?.config;
      if (!poolConfig) return { ok: false, reason: 'migration_no_pool_config' };

      const delegation = await this.fetchDelegationForS(poolId, surveyId, poolConfig, seedS);

      for (const record of records) {
        // createData is public: re-create the SAME data object under S's owner
        // did:key (pool PKP acl read+execute as usual).
        await this.services.nillDB.createData(
          survey,
          poolConfig,
          record.data,
          delegation,
        );
      }

      return { ok: true };
    } catch (e: any) {
      console.error('nilDB E->S migration failed (keeping old leaf):', e);
      return { ok: false, reason: (e as Error)?.message ?? 'migration_error' };
    }
  }

  private async fetchDelegationForS(
    poolId: string,
    surveyId: string,
    poolConfig: any,
    seedS: string,
  ): Promise<string> {
    const signature = await this.services.account.signMessage('s3ntiment:migrate');
    const userDid = `did:key:${seedS}`;
    const args = {
      userDid,
      signature,
      userAddress: this.services.account.getSignerAddress(),
      poolId,
      pkpId: poolConfig?.pkpId,
      pkpDid: poolConfig?.pkpDid,
    };
    const res = await fetch(`${BACKENDURL}/api/surveys/${surveyId}/delegation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const json = await res.json();
    return json.delegation;
  }
}
