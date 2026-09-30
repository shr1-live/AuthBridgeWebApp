# AuthBridge UI

Angular 22 single-page app for the AuthBridge synthetic prior-authorization demo. It deploys
to Vercel as static files and talks only to the AuthBridge API
([shr1-live/AuthBridgeWebApi](https://github.com/shr1-live/AuthBridgeWebApi)). It uses
Supabase directly only to sign in.

> Synthetic healthcare demo — simulated payer responses.

## Run locally

Start the backend first (see the API repository's README), then:

```bash
npm install
npm start          # http://localhost:4200, talks to http://localhost:5243
npm test           # Vitest unit tests
npm run build      # -> dist/authbridge-ui/browser
```

Without `NG_APP_SUPABASE_*` values, the login page lists the backend's seeded Development
users. That sign-in exists only while the backend runs in Development.

## Configuration

`scripts/write-env.mjs` runs before `start`, `build` and `test`. It writes the git-ignored file
`src/environments/environment.generated.ts` from these variables:

| Variable | Meaning |
| --- | --- |
| `NG_APP_API_BASE_URL` | Backend origin. Defaults to `http://localhost:5243` |
| `NG_APP_SUPABASE_URL` | Supabase project URL. Setting it and the key switches to Supabase sign-in |
| `NG_APP_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key only |

The build fails if the key is a secret or service-role key. On Vercel (`VERCEL=1`) it also fails
if any value is missing or not https.

## Pages

| Route | Purpose |
| --- | --- |
| `/login` | Supabase email/password sign-in, or the Development user picker |
| `/authorizations` | Tenant-scoped list with a status, payer, service and ID filter, and pagination |
| `/authorizations/:id` | Details, required-document checklist, fixture attachment, Validate, Prepare, timeline |
| `/proposals/:id` | Human review: confirmation tick, then Approve; then Submit, with a stable idempotency key |
| `/submissions/:id` | Polls the persisted attempt and shows the decision only once recorded |

Route guards only affect what the user sees. The backend enforces every permission, and
buttons are hidden for viewers only as a convenience.

The UI has explicit states for loading, the backend waking up (retried automatically), access
denied, not found, version conflict, expired proposal and a signed-out session (refreshed once
on 401, then sent to sign-in).

## Deploying

See `docs/DEPLOYMENT.md` in the API repository. `vercel.json` pins the build command and the
output directory `dist/authbridge-ui/browser` (checked against a real build), rewrites every
path to `index.html` so deep links survive a refresh, and sets security headers.
