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

On iOS, parent-mode recording writes an M4A file in the app's private storage. After recording stops, the app creates a backend session, uploads ordered 256 KiB byte slices as `audio/mp4`, then completes the session with its duration. Upload progress is saved beside the audio file. While logged in, failed uploads retry when the app reopens, regains connectivity, or returns to the foreground; the app does not promise background uploading. The app deletes the local audio and upload manifest only after the backend confirms completion; interrupted cleanup retries on the next scan. Recordings made with the earlier local-only prototype are not automatically uploaded or deleted. Android native recording and native push are not implemented.

To validate, use a physical iPhone with an account in an active parent period. Record through Home/lock/app switching and stop. Then check the new backend session is `completed`, has ordered chunks, and has `durationSeconds`. Repeat with connectivity disabled before Stop: the recording must stay on the phone, then upload when connectivity returns. Also test app restart during a partial upload. The backend's `merge_recording_chunks.py` must concatenate these byte slices in index order before remuxing; individual M4A slices are not standalone audio files.

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
