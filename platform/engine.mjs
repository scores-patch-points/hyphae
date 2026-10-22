// Runs automations: draft with AI, then either queue for approval or send.
// Guardrails live here, not in the UI: a daily cap per account, a suppression
// list, one send per draft, and an audit row for every action.
import { open, seal } from "./crypto.mjs";
import { buildRaw } from "./mime.mjs";

export const HARD_DAILY_CAP = 100;
const DAY = 86400000;

export function createEngine({ store, google, ai, key, now = () => Date.now() }) {
  const access = new Map(); // account id -> { token, exp }

  async function accessToken(account) {
    const c = access.get(account.id);
    if (c && c.exp > now() + 60000) return c.token;
    const t = await google.refresh(open(key, account.refresh_sealed));
    access.set(account.id, { token: t.access, exp: now() + t.expiresIn * 1000 });
    return t.access;
  }

  async function deliver(draftId) {
    if (!store.claimDraft(draftId)) return { ok: false, error: "draft is not pending" };
    const d = store.draft(draftId);
    const account = store.account(d.account_id);
    try {
      const cap = Math.min(HARD_DAILY_CAP, store.automation(d.automation_id)?.daily_cap ?? HARD_DAILY_CAP);
      if (store.sentSince(account.id, now() - DAY) >= cap) throw new Error(`daily cap of ${cap} reached`);
      if (store.isSuppressed(account.id, d.to_addr)) throw new Error("recipient is on the suppression list");
      const raw = buildRaw({ from: account.email, to: d.to_addr, subject: d.subject, text: d.body });
      const gmailId = await google.send(await accessToken(account), raw);
      store.setDraft(d.id, { status: "sent", sent: now(), gmail_id: gmailId, error: null });
      store.audit(now(), account.id, "send", `draft ${d.id} to ${d.to_addr}`);
      return { ok: true, gmailId };
    } catch (e) {
      store.setDraft(d.id, { status: "failed", error: e.message });
      store.audit(now(), account.id, "send_failed", `draft ${d.id}: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  return {
    seal: (token) => seal(key, token),
    deliver,
    async runAutomation(id) {
      const a = store.automation(id);
      if (!a) throw new Error("no such automation");
      const account = store.account(a.account_id);
      store.touchAutomation(a.id, now());
      const made = [];
      for (const r of JSON.parse(a.recipients)) {
        if (store.isSuppressed(account.id, r.email)) continue;
        try {
          const d = await ai.draft({ instructions: a.instructions, recipient: r });
          const draftId = store.addDraft({ account_id: account.id, automation_id: a.id, to: r.email, ...d, status: "pending", created: now() });
          store.audit(now(), account.id, "draft", `automation ${a.id} to ${r.email}`);
          made.push(draftId);
          if (a.mode === "auto") await deliver(draftId);
        } catch (e) {
          store.audit(now(), account.id, "draft_failed", `automation ${a.id} to ${r.email}: ${e.message}`);
        }
      }
      return made;
    },
    async tick() {
      const ran = [];
      for (const a of store.dueAutomations(now())) ran.push(await this.runAutomation(a.id));
      return ran;
    },
    reject(draftId) {
      store.setDraft(draftId, { status: "rejected" });
    },
    async disconnect(accountId) {
      const account = store.account(accountId);
      if (!account) return;
      try { await google.revoke(open(key, account.refresh_sealed)); } catch { /* the token may already be revoked */ }
      store.deleteAccount(accountId);
      access.delete(accountId);
      store.audit(now(), accountId, "disconnect", account.email);
    },
  };
}
