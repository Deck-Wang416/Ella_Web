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
