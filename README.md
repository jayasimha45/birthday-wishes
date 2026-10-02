# Birthday Wishes

A cinematic, responsive birthday experience built with semantic HTML, CSS, and vanilla JavaScript. Personal details live in `data/birthday-config.js`; the presentation and interactions are separate. The existing Python service remains available for the birthday registry, optional WhatsApp notifications, and optional Google sign-in.

## Run locally

Use Python 3.10 or newer:

```powershell
python server.py
```

Open `http://localhost:8000`. The server creates runtime session, upload, and notification files as needed. Keep Twilio and OAuth secrets in the server-side, git-ignored `data/config.local.json`; never put them in `data/birthday-config.js` or browser code. Existing `data/config.json` remains a safe default sample and migration fallback.

The registry, phone sign-in, Google sign-in, and notification integrations need the Python server. The birthday story itself is static and can be hosted separately. Do not expose the development server directly to the public internet; deploy behind HTTPS with a production-grade WSGI/ASGI server, request throttling, secure secret storage, and managed persistent storage before enabling accounts or messaging at scale.

## Personalize a celebration

Edit `data/birthday-config.js`:

```js
window.birthdayConfig = Object.freeze({
  name: "Dear Friend",
  message: "May your dreams be bigger, your smiles be brighter, and your journey be filled with endless happiness.",
  sender: "Always",
  birthdayDate: "2026-12-24", // YYYY-MM-DD; leave empty for a daily countdown
  memories: [],
  music: "",
  theme: "midnight-gold"
});
```

Gallery images and the cinematic backgrounds are currently served by Unsplash's image CDN. Replace their `images.unsplash.com` URLs with licensed photographs you control before commercial use. Add licensed audio at `music` in the config to use a track; when it is blank the optional control plays a quiet Web Audio ambient tone. Audio starts only after the visitor taps Music.

## Deploy

The static front end can be hosted on GitHub Pages or any static host. Configure the host's base path correctly for a repository subpath. The canonical URL, sitemap, robots file, and social sharing links currently point to the expected GitHub Pages URL; update them if you choose a custom domain.

The Python API is a separate deployment concern: static hosting does not run `server.py`. Configure `PORT`, HTTPS termination, persistent `data/` storage, and OAuth redirect URLs for the actual API host. The in-process OTP throttles and JSON-file storage are suitable only for a small personal deployment, not a multi-user global service.

## Existing member features

- Birthday registration and optional photo upload (up to 5 MB).
- Phone OTP and Google OAuth sign-in when configured.
- Optional Twilio WhatsApp birthday reminders.
- A registry that only lets a signed-in member remove their own entry.
- Notification settings and test sends require a signed-in account.

## Accessibility and performance

Navigation, dialogs, gallery controls, and the image viewer are keyboard accessible. The mobile menu exposes its state to assistive technology, images use descriptive alt text and lazy loading, and `prefers-reduced-motion` disables nonessential movement. No framework or animation library is required.

## SEO and sharing

Page title/description, Open Graph and X card metadata, a favicon, web manifest, `robots.txt`, and `sitemap.xml` are included. Update the canonical and social URLs after choosing the production domain.
