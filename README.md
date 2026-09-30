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

## Design

The UI implements the design bundle in the sibling `authbridge-design` folder. `src/tokens.css` is a verbatim
copy of the bundle's `styles/tokens.css` (the single source of truth for colours, type, spacing,
components and motion); `src/styles.css` adds only the app shell and responsive layout. Light and
dark themes (toggle in the top bar, remembered per browser), 1440 / 768 / 375 layouts, and
`prefers-reduced-motion` are supported.

## Pages

| Route | Purpose |
| --- | --- |
| `/login` | Split brand panel; Supabase sign-in, or the Development user grid (deactivated users cannot be picked) |
| `/authorizations` | Requests: four KPI cards (click to filter), filter card with removable chips, table or card view, document progress, pagination |
| `/submissions` | Requests already sent to the simulated payer |
| `/activity` | Recent status changes across the tenant |
| `/authorizations/:id` | Alerts, hero with 6-step stepper, required-documents checklist, attach fixture, timeline, details and actions |
| `/proposals/:id` | Review and approve: countdown ring, what you are approving, one confirmation tick, Approve; then a separate Submit |
| `/submissions/:id` | Vertical tracker, decision card with payer reference, retry state |

Route guards only affect what the user sees. The backend enforces every permission; viewers see a
"Read-only access" pill and no action buttons.

States: skeleton loading, empty results, backend waking up (retried automatically), request not
found, access denied, access not provisioned, session expired, unexpected error with correlation ID,
changed-since-loaded conflict with Reload, expired and stale reviews.

## Deploying

See `docs/DEPLOYMENT.md` in the API repository. `vercel.json` pins the build command and the
output directory `dist/authbridge-ui/browser` (checked against a real build), rewrites every
path to `index.html` so deep links survive a refresh, and sets security headers.
