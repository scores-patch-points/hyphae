# Google OAuth verification — Hyphae Mail (AI email automation)

Supersedes `GOOGLE-OAUTH-VERIFICATION-hmail.md` (the browser-only encrypted-mail design, parked
2026-10-13). Prepared 2026-10-22. **Nothing has been submitted.** The console project, domain
verification, branding and client from the earlier file are reused; the product they describe
changed, so the pages, justification and demo below replace the old ones.

## 1. What changed, and what that means for review

| | Before | Now |
| --- | --- | --- |
| Product | Browser encrypts mail, sends ciphertext | AI drafts email; user approves or schedules; sent as plain email |
| Token | Access token only, in the browser tab | Refresh token held server-side, sealed at rest |
| Scopes | `openid`, `email`, `gmail.send` | **unchanged** — still sensitive, not restricted, no CASA |
| Name | Hyphae Mail | unchanged |

Reviewer-facing risks, and the answers:

- **"Why does a server hold a refresh token?"** Automations send while the user is away.
  Tokens are AES-256-GCM sealed with a key outside the database, revocable with one button
  (calls Google's revoke endpoint, then deletes the row), and never sent to the AI provider.
- **"Could this be spam software?"** Hard cap of 100 sends/day/account, default 25; default mode
  is human approval per email; a suppression list; recipients are the user's own list; terms
  forbid bulk marketing; every action is logged.
- **"Does AI touch Google user data?"** The only Google user data is the account's email address
  and the ability to send. The model receives the user's own instructions and the user's notes
  about each recipient, never Google data or tokens. Google data is not used to train any model.
- **Staying sensitive, not restricted:** adding read, modify or compose scopes (needed for
  reply-aware automation) triggers the restricted tier and an annual CASA assessment. Do not add
  them without deciding to pay for that.

## 2. Scope justification (paste into the form)

> **gmail.send** — Hyphae Mail lets a user send AI-drafted emails from their own Gmail address.
> The user writes instructions and a recipient list; an AI model drafts one email per recipient
> from that text alone; the user approves each draft, or enables an automation to send on a
> schedule they set. The app then calls `users.messages.send` to deliver the email from the
> user's address. Sending is the only Gmail operation the app performs, so no narrower scope
> exists. The app requests no scope that reads, lists, modifies or deletes mail, drafts, labels,
> contacts or settings, and never reads the user's mailbox. Scheduled sends need offline access,
> so the server stores the refresh token encrypted; the user can revoke and delete it at any
> time from the app or from their Google account.
>
> **openid / email** — to display which Gmail address is connected and to set the From address.

Limited Use statement (already in the privacy policy): Google user data is used only to provide
the user-facing sending feature, is not transferred except as needed for that feature or the law,
is not read by humans, and is not used to train AI models.

## 3. Demo video script (unlisted YouTube; English UI; one take; address bar in frame)

1. `https://mail.hyphae.social/` → scroll to "What Hyphae Mail asks Google for" → open **Privacy**
   and scroll to "How your Google access is handled" and the data table.
2. Click **Open Hyphae Mail** → **Continue with Google**. Pause on Google's consent screen so the
   app name, `client_id` in the URL, and "Send email on your behalf" are readable. Click **Allow**.
3. Dashboard shows the connected address. Create an automation: instructions, two recipients you
   control, mode "Ask me before sending". Click **Run now**.
4. Show two drafts in the queue. Edit one, **Send**, **Discard** the other.
5. Open the recipient's Gmail: show the email arriving from your address.
6. Create a second automation in "Send automatically" with cap 1; run it; show one send and the
   cap stopping the next.
7. Click **Disconnect and delete my data**; show `myaccount.google.com/permissions` no longer lists
   the app.
8. Say aloud: the app can only send, cannot read the mailbox, the AI sees only the text typed here,
   and the token is encrypted and deleted on disconnect.

## 4. Before you submit

- [ ] Redeploy the static site so landing, privacy and terms show the new text (the old pages
      describe encrypted mail and would contradict the demo).
- [ ] Host `platform/` over HTTPS at the redirect URI's host; set the redirect URI and client secret
      (README, step 1). Run `npm run test:platform`.
- [ ] Confirm `VITE_SUPPORT_EMAIL` is a mailbox someone reads.
- [ ] Record the demo against the real deployment, not localhost.
- [ ] Publish app → Submit for verification, paste section 2, add the video link.
- [ ] Terms are boilerplate with no governing-law clause; have them read before relying on them.
- [ ] Anthropic API terms: confirm your plan's data-retention setting matches the privacy page's
      "we do not allow them to train on this data" before publishing that sentence.

## 5. Not verified here

No real Google consent round trip, no real Gmail send, and no live Claude call were run: the
tests use fakes for Google and the model. The first real run needs the client secret and an API key.
