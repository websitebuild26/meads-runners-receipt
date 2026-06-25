# Meads Runners Receipt

Turn your Strava runs into a printable, thermal-style receipt — for Meads Runners.

- **Frontend:** vanilla HTML/CSS/JS in `/public` (no frameworks).
- **Backend:** a single Netlify Function (`netlify/functions/strava-token.js`) that
  exchanges the OAuth `code` / `refresh_token` for an access token, keeping the
  Strava **client secret** server-side.
- **Host:** Netlify — `meads-runners-receipt.netlify.app`.

## Setup

1. **Strava app settings** (https://www.strava.com/settings/api)
   - Authorization Callback Domain: `meads-runners-receipt.netlify.app`
   - Client ID `260923` is hard-coded in `public/app.js` and the function.

2. **Netlify env var**
   - `STRAVA_CLIENT_SECRET` = your Strava client secret (Site settings → Environment variables).

3. **Logo**
   - The Meads Runners logo lives at `public/meads-logo.png` (transparent PNG, landscape).
   - If it's missing, the app simply hides the image — nothing breaks.

## OAuth flow

1. User clicks **Connect with Strava** → redirected to Strava authorize
   (`scope=activity:read`, `redirect_uri=https://…/callback`).
2. Strava redirects back to `/callback?code=…`. `netlify.toml` rewrites `/callback`
   to `index.html`, and `app.js` reads the `code`.
3. `app.js` POSTs the `code` to the function, which exchanges it (with the secret)
   and returns the access/refresh tokens + athlete.
4. Tokens are cached in `localStorage`; the function is reused to refresh them.

## Features

- Strava login for any Meads Runners member.
- Lists **runs only** (`type === "Run"`), newest first, with "Load more".
- Receipt shows distance, pace, moving time, elevation, cadence, calories,
  heart rate (avg/max/zone), kudos, PR count, achievement count.
- **Print** button prints just the receipt (everything else is hidden via `@media print`).
- Mobile-friendly.

## Local dev

```bash
npm install -g netlify-cli   # if needed
STRAVA_CLIENT_SECRET=xxxx netlify dev
```

Plain static preview (login screen only — OAuth needs the function/secret):

```bash
npx serve public
```
