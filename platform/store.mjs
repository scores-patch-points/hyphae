// SQLite store (node:sqlite). Refresh tokens are sealed before they get here.
import { DatabaseSync } from "node:sqlite";

export function openStore(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, refresh_sealed TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS automations (
      id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL,
      recipients TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'approve', every_min INTEGER, daily_cap INTEGER NOT NULL DEFAULT 25,
      enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER);
    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, automation_id INTEGER, to_addr TEXT NOT NULL, subject TEXT NOT NULL,
      body TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL, sent INTEGER, gmail_id TEXT);
    CREATE TABLE IF NOT EXISTS suppressed (account_id INTEGER NOT NULL, addr TEXT NOT NULL, PRIMARY KEY (account_id, addr));
    CREATE TABLE IF NOT EXISTS audit (ts INTEGER NOT NULL, account_id INTEGER, action TEXT NOT NULL, detail TEXT);
  `);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  return {
    db,
    audit: (ts, account_id, action, detail = "") => run("INSERT INTO audit VALUES (?,?,?,?)", ts, account_id, action, String(detail).slice(0, 500)),
    upsertAccount(email, sealed, ts) {
      run("INSERT INTO accounts (email, refresh_sealed, created) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET refresh_sealed=excluded.refresh_sealed", email, sealed, ts);
      return one("SELECT * FROM accounts WHERE email=?", email);
    },
    account: (id) => one("SELECT * FROM accounts WHERE id=?", id),
    deleteAccount(id) {
      for (const t of ["automations", "drafts", "suppressed"]) run(`DELETE FROM ${t} WHERE account_id=?`, id);
      run("DELETE FROM accounts WHERE id=?", id);
    },
    addAutomation(a) {
      const r = run("INSERT INTO automations (account_id,name,instructions,recipients,mode,every_min,daily_cap) VALUES (?,?,?,?,?,?,?)",
        a.account_id, a.name, a.instructions, JSON.stringify(a.recipients), a.mode, a.every_min ?? null, a.daily_cap);
      return Number(r.lastInsertRowid);
    },
    automation: (id) => one("SELECT * FROM automations WHERE id=?", id),
    automations: (account_id) => all("SELECT * FROM automations WHERE account_id=? ORDER BY id", account_id),
    dueAutomations: (ts) => all("SELECT * FROM automations WHERE enabled=1 AND every_min IS NOT NULL AND (last_run IS NULL OR last_run + every_min*60000 <= ?)", ts),
    touchAutomation: (id, ts) => run("UPDATE automations SET last_run=? WHERE id=?", ts, id),
    setEnabled: (id, v) => run("UPDATE automations SET enabled=? WHERE id=?", v ? 1 : 0, id),
    addDraft(d) {
      const r = run("INSERT INTO drafts (account_id,automation_id,to_addr,subject,body,status,created) VALUES (?,?,?,?,?,?,?)",
        d.account_id, d.automation_id ?? null, d.to, d.subject, d.body, d.status, d.created);
      return Number(r.lastInsertRowid);
    },
    draft: (id) => one("SELECT * FROM drafts WHERE id=?", id),
    drafts: (account_id, status) => status
      ? all("SELECT * FROM drafts WHERE account_id=? AND status=? ORDER BY id DESC LIMIT 200", account_id, status)
      : all("SELECT * FROM drafts WHERE account_id=? ORDER BY id DESC LIMIT 200", account_id),
    setDraft: (id, fields) => {
      const keys = Object.keys(fields);
      run(`UPDATE drafts SET ${keys.map((k) => `${k}=?`).join(",")} WHERE id=?`, ...keys.map((k) => fields[k]), id);
    },
    claimDraft: (id) => Number(run("UPDATE drafts SET status='sending' WHERE id=? AND status='pending'", id).changes) === 1,
    sentSince: (account_id, ts) => one("SELECT COUNT(*) n FROM drafts WHERE account_id=? AND status='sent' AND sent>=?", account_id, ts).n,
    suppress: (account_id, addr) => run("INSERT OR IGNORE INTO suppressed VALUES (?,?)", account_id, addr.toLowerCase()),
    isSuppressed: (account_id, addr) => !!one("SELECT 1 x FROM suppressed WHERE account_id=? AND addr=?", account_id, addr.toLowerCase()),
  };
}
