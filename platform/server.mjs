// HTTP front: Google sign-in, a signed session cookie, and a small JSON API
// behind the dashboard. One process, no dependencies.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sign, unsign } from "./crypto.mjs";

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const cookie = (name, value, { maxAge = 86400 * 14 } = {}) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.PLATFORM_INSECURE_COOKIES ? "" : "; Secure"}`;
const parseCookies = (h) => Object.fromEntries(String(h || "").split(/;\s*/).filter(Boolean).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));

export function createApp({ store, google, engine, key, now = () => Date.now() }) {
  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const body = async (req) => { let s = ""; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error("body too large"); } return s ? JSON.parse(s) : {}; };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const cookies = parseCookies(req.headers.cookie);
      const accountId = Number(unsign(key, cookies.sid)) || null;

      if (req.method === "GET" && url.pathname === "/auth/google") {
        const state = randomBytes(16).toString("base64url");
        res.writeHead(302, { location: google.authUrl(state), "set-cookie": cookie("oauth_state", sign(key, state), { maxAge: 600 }) });
        return res.end();
      }
      if (req.method === "GET" && url.pathname === "/auth/callback") {
        const state = unsign(key, cookies.oauth_state);
        if (!state || state !== url.searchParams.get("state")) return json(res, 400, { error: "bad state" });
        if (url.searchParams.get("error")) return json(res, 400, { error: url.searchParams.get("error") });
        const t = await google.exchange(url.searchParams.get("code"));
        const acct = store.upsertAccount(t.email, engine.seal(t.refresh), now());
        store.audit(now(), acct.id, "connect", t.email);
        res.writeHead(302, { location: "/", "set-cookie": [cookie("sid", sign(key, String(acct.id))), cookie("oauth_state", "", { maxAge: 0 })] });
        return res.end();
      }

      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        const file = url.pathname === "/" ? "index.html" : null;
        if (!file) return json(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(await readFile(PUBLIC + file));
      }

      if (!url.pathname.startsWith("/api/")) return json(res, 404, { error: "not found" });
      if (!accountId || !store.account(accountId)) return json(res, 401, { error: "sign in" });
      if (req.method !== "GET" && req.headers["x-requested-with"] !== "hyphae") return json(res, 403, { error: "missing header" });
      const account = store.account(accountId);
      const m = (re) => url.pathname.match(re);

      if (req.method === "GET" && url.pathname === "/api/me") return json(res, 200, { email: account.email });
      if (req.method === "GET" && url.pathname === "/api/automations") return json(res, 200, store.automations(accountId));
      if (req.method === "POST" && url.pathname === "/api/automations") {
        const b = await body(req);
        const recipients = (b.recipients || []).map((r) => ({ email: String(r.email || "").trim(), context: String(r.context || "").slice(0, 2000) }));
        if (!b.name || !b.instructions || !recipients.length || recipients.some((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))) return json(res, 400, { error: "name, instructions and valid recipients required" });
        const id = store.addAutomation({ account_id: accountId, name: String(b.name).slice(0, 120), instructions: String(b.instructions).slice(0, 4000), recipients,
          mode: b.mode === "auto" ? "auto" : "approve", every_min: Number(b.every_min) > 0 ? Number(b.every_min) : null, daily_cap: Math.min(100, Math.max(1, Number(b.daily_cap) || 25)) });
        return json(res, 201, { id });
      }
      let r;
      if (req.method === "POST" && (r = m(/^\/api\/automations\/(\d+)\/run$/))) {
        const a = store.automation(Number(r[1]));
        if (!a || a.account_id !== accountId) return json(res, 404, { error: "not found" });
        return json(res, 200, { drafts: await engine.runAutomation(a.id) });
      }
      if (req.method === "GET" && url.pathname === "/api/drafts") return json(res, 200, store.drafts(accountId, url.searchParams.get("status")));
      if (req.method === "POST" && (r = m(/^\/api\/drafts\/(\d+)\/(approve|reject)$/))) {
        const d = store.draft(Number(r[1]));
        if (!d || d.account_id !== accountId) return json(res, 404, { error: "not found" });
        if (r[2] === "reject") { engine.reject(d.id); return json(res, 200, { ok: true }); }
        const b = await body(req);
        if (typeof b.subject === "string" && typeof b.body === "string" && !/[\r\n]/.test(b.subject)) store.setDraft(d.id, { subject: b.subject, body: b.body });
        return json(res, 200, await engine.deliver(d.id));
      }
      if (req.method === "POST" && (r = m(/^\/api\/suppress$/))) { store.suppress(accountId, String((await body(req)).email || "")); return json(res, 200, { ok: true }); }
      if (req.method === "POST" && url.pathname === "/api/disconnect") {
        await engine.disconnect(accountId);
        res.writeHead(200, { "content-type": "application/json", "set-cookie": cookie("sid", "", { maxAge: 0 }) });
        return res.end('{"ok":true}');
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  });
}
