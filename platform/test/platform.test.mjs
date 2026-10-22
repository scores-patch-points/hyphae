import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, open, sign, unsign, loadKey } from "../crypto.mjs";
import { buildRaw } from "../mime.mjs";
import { openStore } from "../store.mjs";
import { createEngine } from "../engine.mjs";
import { createApp } from "../server.mjs";
import { createGoogle, SCOPES } from "../google.mjs";
import { createAI } from "../ai.mjs";

const key = randomBytes(32);
const mkFakes = () => {
  const sent = [];
  const google = {
    authUrl: (s) => `https://accounts.example/auth?state=${s}`,
    exchange: async () => ({ refresh: "R1", email: "me@example.com" }),
    refresh: async () => ({ access: "A1", expiresIn: 3600 }),
    send: async (tok, raw) => { sent.push({ tok, raw }); return "g" + sent.length; },
    revoke: async () => {},
  };
  const ai = { draft: async ({ recipient }) => ({ subject: `Hi ${recipient.email}`, body: "Hello." }) };
  return { sent, google, ai };
};
const setup = (t = 1e12) => {
  const f = mkFakes(); const store = openStore(); let clock = t;
  const engine = createEngine({ store, google: f.google, ai: f.ai, key, now: () => clock });
  const acct = store.upsertAccount("me@example.com", engine.seal("R1"), clock);
  return { ...f, store, engine, acct, tick: (ms) => (clock += ms) };
};
const auto = (s, o = {}) => s.store.addAutomation({ account_id: s.acct.id, name: "n", instructions: "x", recipients: [{ email: "a@x.com" }, { email: "b@x.com" }], mode: "approve", daily_cap: 25, ...o });

test("seal/open round trips and rejects tampering and wrong keys", () => {
  const s = seal(key, "refresh");
  assert.equal(open(key, s), "refresh");
  assert.throws(() => open(randomBytes(32), s));
  const b = Buffer.from(s, "base64"); b[30] ^= 1;
  assert.throws(() => open(key, b.toString("base64")));
  assert.equal(unsign(key, sign(key, "7")), "7");
  assert.equal(unsign(key, sign(key, "7") + "x"), null);
  assert.throws(() => loadKey("short"));
});

test("mime encodes UTF-8 and refuses header injection", () => {
  const raw = Buffer.from(buildRaw({ from: "a@x.com", to: ["b@x.com"], subject: "Café ✓", text: "héllo" }), "base64url").toString();
  assert.match(raw, /^From: a@x\.com\r\nTo: b@x\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.throws(() => buildRaw({ from: "a@x.com", to: "b@x.com\r\nBcc: z@x.com", subject: "s", text: "t" }));
  assert.throws(() => buildRaw({ from: "a@x.com", to: "b@x.com", subject: "s\r\nBcc: z@x.com", text: "t" }));
});

test("approve mode queues; approving sends once with the user's From", async () => {
  const s = setup();
  const ids = await s.engine.runAutomation(auto(s));
  assert.equal(ids.length, 2); assert.equal(s.sent.length, 0);
  assert.equal((await s.engine.deliver(ids[0])).ok, true);
  assert.equal((await s.engine.deliver(ids[0])).ok, false); // no double send
  assert.equal(s.sent.length, 1);
  assert.match(Buffer.from(s.sent[0].raw, "base64url").toString(), /From: me@example\.com/);
  assert.equal(s.sent[0].tok, "A1");
});

test("auto mode sends; daily cap and suppression stop further sends", async () => {
  const s = setup();
  s.store.suppress(s.acct.id, "b@x.com");
  await s.engine.runAutomation(auto(s, { mode: "auto", daily_cap: 1 }));
  assert.equal(s.sent.length, 1); // b suppressed
  const id2 = auto(s, { mode: "auto", daily_cap: 1, recipients: [{ email: "c@x.com" }] });
  const [d] = await s.engine.runAutomation(id2);
  assert.equal(s.sent.length, 1);
  assert.match(s.store.draft(d).error, /daily cap/);
  s.tick(86400001);
  const [d2] = await s.engine.runAutomation(id2);
  assert.equal(s.store.draft(d2).status, "sent");
});

test("scheduler runs only due automations", async () => {
  const s = setup();
  auto(s, { every_min: 10 });
  assert.equal((await s.engine.tick()).length, 1);
  assert.equal((await s.engine.tick()).length, 0);
  s.tick(10 * 60000);
  assert.equal((await s.engine.tick()).length, 1);
});

test("disconnect revokes and deletes everything held for the account", async () => {
  const s = setup(); await s.engine.runAutomation(auto(s));
  await s.engine.disconnect(s.acct.id);
  assert.equal(s.store.account(s.acct.id), undefined);
  assert.equal(s.store.automations(s.acct.id).length, 0);
  assert.equal(s.store.drafts(s.acct.id).length, 0);
});

test("google client asks for gmail.send only and rejects a grant without it", async () => {
  assert.deepEqual(SCOPES, ["openid", "email", "https://www.googleapis.com/auth/gmail.send"]);
  const g = createGoogle({ clientId: "cid", clientSecret: "s", redirectUri: "http://l/cb", fetch: async () => ({ ok: true, json: async () => ({ refresh_token: "r", scope: "openid email", id_token: "a." + Buffer.from('{"email":"e@x.com"}').toString("base64url") + ".c" }) }) });
  assert.match(g.authUrl("st"), /access_type=offline/);
  await assert.rejects(g.exchange("code"), /gmail\.send was not granted/);
});

test("ai drafter parses JSON and rejects an empty draft", async () => {
  const mk = (text) => createAI({ apiKey: "k", fetch: async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text }] }) }) });
  const d = await mk('Sure:\n{"subject":"Hi\\nthere","body":"Body"}').draft({ instructions: "i", recipient: { email: "a@x.com" } });
  assert.deepEqual(d, { subject: "Hi there", body: "Body" });
  await assert.rejects(mk('{"subject":"","body":"x"}').draft({ instructions: "i", recipient: { email: "a@x.com" } }));
});

test("http: oauth state is enforced, API needs a session and the CSRF header, accounts are isolated", async () => {
  process.env.PLATFORM_INSECURE_COOKIES = "1";
  const s = setup(); const other = s.store.upsertAccount("other@example.com", s.engine.seal("R2"), 1e12);
  const srv = createApp({ store: s.store, google: s.google, engine: s.engine, key }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(base + "/api/me")).status, 401);
    assert.equal((await fetch(base + "/auth/callback?state=x&code=c", { redirect: "manual" })).status, 400);
    const start = await fetch(base + "/auth/google", { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const stateCookie = start.headers.get("set-cookie").split(";")[0];
    const cb = await fetch(`${base}/auth/callback?state=${state}&code=c`, { redirect: "manual", headers: { cookie: stateCookie } });
    assert.equal(cb.status, 302);
    const sid = cb.headers.getSetCookie().find((c) => c.startsWith("sid=")).split(";")[0];
    const H = { cookie: sid, "x-requested-with": "hyphae", "content-type": "application/json" };
    assert.equal((await (await fetch(base + "/api/me", { headers: H })).json()).email, "me@example.com");
    assert.equal((await fetch(base + "/api/automations", { method: "POST", headers: { cookie: sid }, body: "{}" })).status, 403);
    const mine = await (await fetch(base + "/api/automations", { method: "POST", headers: H, body: JSON.stringify({ name: "a", instructions: "i", recipients: [{ email: "z@x.com" }] }) })).json();
    const theirs = s.store.addAutomation({ account_id: other.id, name: "t", instructions: "i", recipients: [], mode: "approve", daily_cap: 5 });
    assert.equal((await fetch(`${base}/api/automations/${theirs}/run`, { method: "POST", headers: H, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/api/automations/${mine.id}/run`, { method: "POST", headers: H, body: "{}" })).status, 200);
    assert.equal(s.sent.length, 0); // approve mode: nothing leaves without a click
  } finally { srv.close(); }
});
