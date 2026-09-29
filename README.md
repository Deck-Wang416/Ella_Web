# ELLA

React + Vite + Tailwind frontend for the ELLA web/PWA and Capacitor mobile app.

## Run

```bash
npm install
npm run dev
```

## Mobile shell

Requires Node 22 (`nvm use`), Xcode for iOS, and Android Studio/SDK for Android.

```bash
npm install
npm run mobile:sync
npx cap open ios
# or: npx cap open android
```

`mobile:sync` builds with `https://hri-autism-backend.onrender.com/api` and copies the output into both native projects. To use another backend, set `ELLA_MOBILE_API_BASE` to an HTTPS URL ending in `/api` before running it. The native bundle ID is provisionally `com.ella.parentportal`.

This first mobile build is for shell/login/API testing. Background recording and native push are not implemented yet; do not use it for study recordings.

## Env

Create `.env.local`:

```env
VITE_API_BASE=http://127.0.0.1:8000/api
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
```

## Main API

- `POST /api/profiles/login`
- `GET /api/profiles/{caregiverId}`
- `PUT /api/profiles/{caregiverId}`
- `GET /api/daily/summaries?timezone=America/New_York&caregiver_id={id}`
- `GET /api/daily/{date}?timezone=America/New_York&caregiver_id={id}`
- `PUT /api/daily/{date}?timezone=America/New_York&caregiver_id={id}`
- `POST /api/recordings/sessions`
- `GET /api/recordings/sessions/{sessionId}`
- `POST /api/recordings/sessions/{sessionId}/chunks`
- `POST /api/recordings/sessions/{sessionId}/complete`
- `POST /api/subscriptions`
- `PUT /api/subscriptions/{id}`

## Notes

- Daily is single-mode: `condition` is either `robot` or `parent`.
- Dashboard always reads `today`; Diary can still browse selectable dates returned by the backend.
- Recording UI is only enabled when `condition === "parent"`.
- Robot dashboard themes are stored in profile `themes` and edited from the robot dashboard only.
- Web Push uses the backend VAPID public key.
