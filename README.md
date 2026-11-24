# ELLA Frontend

React, Vite, and Tailwind frontend for the ELLA web/PWA and Capacitor iOS/Android apps. The same React UI serves both; recording and push notifications use platform-specific implementations.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
npm test
npm run build
```

For a local backend, create `.env.local`:

```env
VITE_API_BASE=http://127.0.0.1:8000/api
VITE_WEB_PUSH_VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
```

Without `VITE_API_BASE`, the web build uses `/api` on its own origin. Web Push also needs the VAPID public key and a service worker. Do not put private keys in frontend environment variables.

## Mobile Builds

The Capacitor app ID is `com.ella.parentportal`. Install Xcode for iOS or the Android SDK for Android, then run from this repository root:

```bash
npm run mobile:sync
npx cap open ios
# or: npx cap open android
```

`mobile:sync` builds the web assets and copies them into both native projects. By default, the mobile build uses `https://hri-autism-backend.onrender.com/api`; set `ELLA_MOBILE_API_BASE` to another HTTPS API URL before syncing if needed. A native app does **not** update when Firebase Hosting is redeployed: rebuild and redistribute it after frontend or native code changes. The web build is deployed separately with `npm run build` and `firebase deploy --only hosting`.

## App Flow

- Login returns the caregiver profile. Its condition ranges determine the active robot/parent mode and `dayCount`; dates outside a configured period are blocked. Daily requests are scoped by `caregiver_id`.
- The Dashboard shows today's data; the Diary uses backend-provided dates and question schemas. Only today's diary is editable. Robot story themes are read and updated through the profile API on the robot dashboard.
- Web parent-mode recording uses `MediaRecorder` and uploads roughly 3-second chunks. Native recording writes roughly 3-second WAV segments to app-private storage and uploads up to four concurrently through iOS/Android native background transfer. The native uploader can resume unfinished uploads after interruption or relaunch; an audio interruption ends the current recording rather than silently resuming it.
- Both recording paths use `/api/recordings/sessions`, `/chunks`, and `/complete`. After the backend accepts `/complete`, the App shows `Recording uploaded to ELLA` and starts removing local segments; it does not wait for the backend's asynchronous merge. An unfinished native upload blocks a new recording. `Discard upload` cancels the backend session before deleting its local audio.
- Web/PWA notifications use Web Push and `public/sw.js`; native apps register APNs (iOS) or FCM (Android) tokens through `/api/subscriptions`. Explicit logout and account switching deactivate the previous device binding.

## Native Setup

- iOS: enable the Push Notifications capability and sign with a team that supports APNs. Development builds use the sandbox APNs environment; distributed builds use production. The backend needs the matching APNs credentials.
- Android: register `com.ella.parentportal` in the backend's Firebase project and put its `google-services.json` at `android/app/google-services.json` (gitignored). Firebase Admin credentials remain on the backend.
- Test recording, background transfer, and push delivery on physical devices. Background transfer can still be delayed by OS or network conditions; reopening the app resumes pending work.

## Repository Map

- `src/components/`: Dashboard, Diary, and web/native recording UI.
- `src/context/`, `src/hooks/`: caregiver/profile state and notification lifecycle.
- `src/lib/`: API clients, timezone handling, and native recording synchronization.
- `ios/`, `android/`: Capacitor native projects, including recording uploaders.
- `public/sw.js`: web service worker; `firebase.json`: Firebase Hosting configuration.
