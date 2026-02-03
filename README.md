# RoutineFlow

A mobile-first PWA for daily routine tracking, smart repeats, and goal progress bars.

## Features
- Routine tasks with time, repeat options, alarm toggle, and notes
- Progress goals with a visual progress bar (water intake, etc.)
- Local-only storage (ready for cloud sync later)
- Installable on Android as a PWA
- Offline-capable with a service worker

## Run locally
- Open `index.html` directly, or use a simple local server
- For a local server: `python3 -m http.server 5173`

## Launch to the internet (Android-ready)
1. Upload this folder to any static host (Netlify, Vercel, GitHub Pages, S3).
2. Ensure HTTPS is enabled (required for service workers and installability).
3. Visit the hosted URL in Chrome on Android and tap `Install app`.

## One-click deploy (Vercel)
1. In your Vercel dashboard, click **New Project**.
2. Import the `Routine-Tracker` GitHub repo.
3. Framework preset: **Other** (static).
4. Build command: **None**.
5. Output directory: **/** (project root).
6. Deploy.

## Background reminders (Android)
RoutineFlow uses a service worker + background sync to deliver reminder notifications on Android.
This works best on Chrome Android and may be throttled by the OS when the app is idle.

## Customizing icons
- Replace the PNG files in `icons/` with your own 192x192 and 512x512 icons.
- Keep both standard and maskable versions for the best Android experience.

## Next upgrades
- Cloud sync + accounts (Firebase, Supabase, or your own API)
- True background notifications via a native wrapper (Capacitor)
