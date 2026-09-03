# Staff Call Log

A mobile-first PWA for working a call list: import a CSV, tap to dial, log the
outcome, export the results. No build step, no backend, no login — all data
lives in the browser's local storage on the device it was imported on.

## Use it

1. Serve the folder over HTTPS (or `localhost` for local testing) — service
   workers and "Add to Home Screen" both require a secure origin.
   ```
   npx http-server . -p 8080
   ```
2. Open it on the phone (Safari on iOS, Chrome on Android).
3. Tap **Choose CSV file** and pick a CSV with a name column and a phone
   column (headers like `Name`/`Phone`, `Full Name`/`Mobile`, etc. are
   detected automatically; otherwise the first two columns are used).
4. Tap a phone number to open the native dialer. After the call, tap an
   outcome chip (Reached, Voicemail, No Answer, Wrong Number, Call Back
   Later) and optionally add a note.
5. Tap the export icon in the header to download an updated CSV with
   Status, Notes, and Called At columns filled in.
6. To install as an app icon: iOS — Share → Add to Home Screen. Android —
   the in-app **Install** banner, or Chrome's menu → Add to Home Screen.

## Notes

- Everything is static (`index.html`, `styles.css`, `app.js`,
  `manifest.webmanifest`, `service-worker.js`, `icons/`) — deploy it to any
  static host (GitHub Pages, Netlify, S3, etc.).
- Data never leaves the device: no network calls, no analytics.
- Re-importing a CSV replaces the current list (with a confirmation prompt).
  "Clear list & start over" wipes local storage.
- `icons/generate-icons.js` is the one-off script used to generate the PWA
  icon PNGs (no external image tooling required); it doesn't need to be run
  again unless the icon design changes.
