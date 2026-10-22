// Local preview with fakes: no Google, no Claude, nothing is sent.
// "Continue with Google" signs in as demo@example.com and the drafts are canned.
import { randomBytes } from "node:crypto";
import { openStore } from "./store.mjs";
import { createEngine } from "./engine.mjs";
import { createApp } from "./server.mjs";

process.env.PLATFORM_INSECURE_COOKIES = "1";
const port = Number(process.env.PORT || 8787);
const key = randomBytes(32);
const store = openStore();
const google = {
  authUrl: (state) => `/auth/callback?code=demo&state=${state}`,
  exchange: async () => ({ refresh: "demo", email: "demo@example.com" }),
  refresh: async () => ({ access: "demo", expiresIn: 3600 }),
  send: async () => { console.log("[demo] pretend-sent"); return "demo-id"; },
  revoke: async () => {},
};
const ai = {
  draft: async ({ recipient }) => ({
    subject: "Thursday follow-up",
    body: `Hi ${recipient.email.split("@")[0]},\n\nThanks for the call yesterday. ${recipient.context || ""}\nWould Thursday afternoon work to continue?\n\nBest,\nDemo`,
  }),
};
const engine = createEngine({ store, google, ai, key });
const acct = store.upsertAccount("demo@example.com", engine.seal("demo"), Date.now());
const id = store.addAutomation({ account_id: acct.id, name: "Post-call follow-ups", instructions: "Thank them for yesterday's call and propose Thursday.",
  recipients: [{ email: "ana@example.org", context: "Asked about pricing." }, { email: "ben@example.org", context: "Wants the Q4 timeline." }], mode: "approve", daily_cap: 25 });
await engine.runAutomation(id);
createApp({ store, google, engine, key }).listen(port, () => console.log(`demo on http://localhost:${port}`));
