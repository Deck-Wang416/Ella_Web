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

On iOS and Android, parent-mode recording seals independent WAV segments about every 3 seconds in app-private storage. While the app is visible, it uploads sealed segments to one backend session (`chunkFormat: "standalone"`). After Stop, it uploads the final segment and calls `/complete`; the backend verifies and merges the segments into one M4A, then deletes Storage source chunks. The app deletes its local segments only after `mergeStatus: "completed"` and `finalAudio.storagePath` are confirmed. Failed uploads retry on connectivity, visibility, or app restart while the same caregiver is signed in. Capture can continue in the background, but upload while the app is backgrounded is **not guaranteed**; queued local segments are uploaded when the app resumes.

On iOS, a system audio interruption automatically stops and seals the current recording. Captured segments remain local until upload and merge finish; recording does not silently resume across the interruption.

For a stopped recording whose upload fails, Retry upload keeps the local audio. Discard upload requires confirmation, cancels only that recording's backend session and source chunks, then removes its local audio. If server cancellation fails, the local recording is kept.

Deploy the backend WAV/standalone merge support before testing this mobile build. Validate on physical iPhone and Android devices: record during Home/lock/app switching, reconnect after network loss, stop, and verify the session reaches `mergeStatus: "completed"` with `finalAudio`; confirm both Storage source chunks and app-private segments are removed. Android requires an installed Android SDK to build; iOS simulator compilation alone does not validate background capture on a device.

## Native notifications

After login, the App registers an APNs token on iOS or FCM token on Android and sends it to `/api/subscriptions`. Explicit logout and caregiver switching deactivate the prior binding; Web/PWA Push remains separate.

- iOS: enable the Push Notifications capability for `com.ella.parentportal` in Xcode with a provisioning profile that supports it. Configure backend `APNS_*` values; use sandbox for development builds and production for distributed builds.
- Android: register `com.ella.parentportal` in the Firebase project used by the backend, then place its `google-services.json` in `android/app/` (gitignored).
- Backend: deploy the native providers and set `MOBILE_PUSH_DRY_RUN=false`. Without platform credentials, real delivery is not available.

Validate on physical devices using `/api/subscriptions/{caregiverId}` and backend delivery logs. Android Back returns from Diary to Dashboard and otherwise minimizes the App; an open keyboard or profile dialog closes first.

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
- `POST /api/recordings/sessions/{sessionId}/cancel`
- `POST /api/subscriptions`
- `PUT /api/subscriptions/{id}`

## Notes

- Daily is single-mode: `condition` is either `robot` or `parent`.
- Dashboard always reads `today`; Diary can still browse selectable dates returned by the backend.
- Recording UI is only enabled when `condition === "parent"`.
- Robot dashboard themes are stored in profile `themes` and edited from the robot dashboard only.
- Web Push uses the backend VAPID public key.
