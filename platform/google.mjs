// Google OAuth (authorization-code flow, offline access) and the one Gmail call
// the platform makes. Scopes are fixed at gmail.send + identity: nothing here
// can read, list, modify or delete mail.
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];

export function createGoogle({ clientId, clientSecret, redirectUri, fetch: f = fetch }) {
  const form = (o) => new URLSearchParams(o).toString();
  const post = async (url, body) => {
    const r = await f(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`google ${r.status}: ${j.error_description || j.error || "request failed"}`);
    return j;
  };
  return {
    authUrl(state) {
      return "https://accounts.google.com/o/oauth2/v2/auth?" + form({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
        access_type: "offline", prompt: "consent", state,
      });
    },
    async exchange(code) {
      const t = await post("https://oauth2.googleapis.com/token", {
        code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
      });
      if (!t.refresh_token) throw new Error("google returned no refresh token");
      if (!String(t.scope || "").includes("gmail.send")) throw new Error("gmail.send was not granted");
      // The id_token arrives straight from Google's token endpoint over TLS.
      const claims = JSON.parse(Buffer.from(String(t.id_token).split(".")[1], "base64url").toString());
      if (!claims.email || claims.email_verified === false) throw new Error("no verified email on the account");
      return { refresh: t.refresh_token, access: t.access_token, expiresIn: t.expires_in, email: claims.email, sub: claims.sub };
    },
    async refresh(refreshToken) {
      const t = await post("https://oauth2.googleapis.com/token", {
        refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token",
      });
      return { access: t.access_token, expiresIn: t.expires_in };
    },
    async send(accessToken, raw) {
      const r = await f("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ raw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`gmail ${r.status}: ${j.error?.message || "send failed"}`);
      return j.id;
    },
    async revoke(token) {
      await f("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ token }) });
    },
  };
}
