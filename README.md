# ELLA Web

React + Vite + Tailwind frontend for the ELLA parent portal / PWA.

## Run

```bash
npm install
npm run dev
```

## Env

Create `.env.local`:

```env
VITE_API_BASE=http://127.0.0.1:8000/api
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
```

## Main API

- `GET /api/daily/summaries?timezone=America/New_York`
- `GET /api/daily/{date}?timezone=America/New_York`
- `PUT /api/daily/{date}?timezone=America/New_York`
- `POST /api/daily/{date}/initialize?timezone=America/New_York`
- `POST /api/recordings/sessions`
- `GET /api/recordings/sessions/{sessionId}`
- `POST /api/recordings/sessions/{sessionId}/chunks`
- `POST /api/recordings/sessions/{sessionId}/complete`
- `POST /api/subscriptions`
- `PUT /api/subscriptions/{id}`

## Notes

- Daily is single-mode: `condition` is either `robot` or `parent`.
- Recording UI is only enabled when `condition === "parent"`.
- Web Push uses the backend VAPID public key.
