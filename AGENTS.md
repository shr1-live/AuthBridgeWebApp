# Agent instructions (AuthBridgeWebApp)

- The browser holds only public values: API URL, Supabase URL and the publishable key. Never
  add a secret, service-role key or database connection string. `scripts/write-env.mjs` enforces this.
- Domain data goes through the AuthBridge API. Use Supabase from the browser for sign-in only.
- Keep business rules out of Angular. Use guards and disabled buttons for what the user sees;
  the backend decides permissions.
- Approval happens only on an explicit click (confirmation tick plus Approve) on the review
  page. Never approve automatically, on load or through a GET.
- Never show an approval or denial before the backend reports it.
- Keep the "Synthetic healthcare demo — simulated payer responses." banner on every page.
- Never put tokens in URLs, logs or custom storage. The Supabase client manages its own session.
- Run `npm test` and `npm run build` before committing. Commit as `shr1-live` and push to
  `origin/main` right after each commit.
