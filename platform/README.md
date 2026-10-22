# Hyphae Mail platform

An AI email automation service on your own Gmail. Zero dependencies; Node 22+ (`node:sqlite`).

```
Google sign-in (gmail.send only) ─► sealed refresh token (AES-256-GCM, key in env)
automation (instructions + recipients) ─► Claude drafts one email each
                     ├─ "ask me first" ─► approval queue ─► you edit / send / discard
                     └─ "send automatically" ─► Gmail users.messages.send
guardrails: daily cap (default 25, hard max 100) · suppression list · one send per draft · audit log
```

It cannot read mail: the only Gmail call is `users.messages.send`, and the client asks for
`openid email gmail.send` and refuses a grant that lacks `gmail.send`.

## Run it

```bash
export PLATFORM_KEY=$(openssl rand -base64 32)   # keep it; losing it orphans stored tokens
export GOOGLE_CLIENT_ID=...apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=...
export ANTHROPIC_API_KEY=...
export PLATFORM_BASE_URL=https://app.hyphae.social   # or http://localhost:8787 for dev
PLATFORM_INSECURE_COOKIES=1 npm run platform          # drop the flag behind HTTPS
npm run test:platform
```

Serve it over HTTPS in production (cookies are `Secure`). The landing page at
`mail.hyphae.social` is static; this service lives at `VITE_PLATFORM_URL`.

## Google Cloud Console walkthrough

The project **HMail** (`fleet-aleph-510904-f5`, owned by `michael.t.lacy@gmail.com`) already has
the Gmail API enabled, the branding, the `gmail.send` scope and a web client. The platform
changes what that client needs, so do these steps in <https://console.cloud.google.com/auth>
with that project selected:

1. **Clients → "Hyphae Mail web".** The old design used a browser-only token flow; this one uses
   the authorization-code flow with a server.
   - *Authorized redirect URIs* → add `https://<your platform host>/auth/callback`
     (for example `https://app.hyphae.social/auth/callback`) and `http://localhost:8787/auth/callback` for dev.
   - Copy the **Client ID** (unchanged: the one already in the repo variable) and create/download a
     **Client secret**. The secret goes only into `GOOGLE_CLIENT_SECRET` on the server, never into
     the repo or a `VITE_` variable.
   - The old JavaScript origin can stay; it is unused by the server flow.
2. **Branding.** App name stays **Hyphae Mail**. Update the *Application home page* only if the
   host changed; set *Authorized domains* to include the platform host's registrable domain
   (`hyphae.social` already covers `app.hyphae.social`). Privacy and terms stay at
   `https://mail.hyphae.social/privacy/` and `/terms/` — redeploy the repo first so they carry the
   rewritten text.
3. **Data access.** Confirm exactly three scopes: `openid`, `…/auth/userinfo.email`,
   `…/auth/gmail.send`. If the justification box is editable, paste section 2 of
   `GOOGLE-VERIFICATION.md`.
4. **Audience.** Keep *External*. While in *Testing*, add yourself as a test user; refresh tokens
   issued in Testing expire after 7 days, so the unattended automations will stop weekly until the
   app is published.
5. **Publish app → Submit for verification** after the demo video (section 3 of
   `GOOGLE-VERIFICATION.md`) is recorded.

Repo variables to set (Settings → Secrets and variables → Actions → Variables):
`VITE_SUPPORT_EMAIL`, `VITE_PLATFORM_URL`.
