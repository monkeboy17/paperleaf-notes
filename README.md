# Paperleaf Notes

A small, mobile-first note-taking app with a calm interface and straightforward organization. Built with vanilla HTML, CSS, and JavaScript — no framework, build step, account, or external runtime dependency.

## Features

- **Local-first storage:** notes and folders live in the browser's IndexedDB on this device.
- **Organization:** folders, tags, favorites, pinned notes, archive, and trash.
- **Writing:** rich-text basics (bold, italic, underline, headings, lists, and checklist markers), with a preview mode.
- **Finding things:** instant full-text search across titles, note text, tags, and folder names.
- **Useful extras:** note colors, sort controls, dark theme, word count, keyboard shortcuts, JSON backup/restore, and Markdown export for an individual note.
- **Phone-friendly:** responsive layout, touch-sized controls, slide-out navigation, and an installable PWA shell.
- **Open source:** MIT license.

## Run locally

IndexedDB and the offline service worker work best when the app is served from `localhost` or HTTPS. From this folder, run:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Install on a phone

1. Put the files inside this folder at the root of a static HTTPS site (GitHub Pages, Cloudflare Pages, or Netlify all work).
2. Open that HTTPS address in your phone's browser.
3. In Chrome on Android, open the browser menu and choose **Install app** or **Add to Home screen**.

The app shell is cached for offline use after the first successful load. The interface uses system fonts and makes no font-service requests. This is an installable web app (PWA), not a native Android APK.

### Quick GitHub Pages route

Create a repository, upload the contents of this folder to its root, then open **Settings → Pages**. Under the build/deployment source, choose **Deploy from a branch**, select `main` and `/(root)`, and save. Once GitHub Pages gives the repository a site address, visit it on your phone and install it from Chrome.

## Data and privacy

There is no account or cloud sync. Notes are stored in the browser profile on the device. Browser storage can be cleared by the user or browser, so use **Backup & settings → Export** regularly. A JSON backup can be imported on another device, but this is a manual transfer — it is not sync.

## Keyboard shortcuts

- `Ctrl/⌘ + N`: new note
- `Ctrl/⌘ + K`: focus search
- `Ctrl/⌘ + S`: request save

## License

MIT — see [LICENSE](LICENSE).
