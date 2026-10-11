# StoryMaps

Self-hosted, scroll-driven map stories with a visual builder. It's an open-source, clean-room take on the ArcGIS StoryMaps experience.

- **Write a story** from blocks: text, images, video, embeds, maps, scrolling map "sidecars", guided tours, and swipe comparisons.
- **Bring your data**: GeoJSON, CSV, or public ArcGIS feature layers, styled by category or value, with popups and a legend.
- **Publish it** to a public link. Draft edits stay private until you publish again.

There's nothing to install beyond Node.js, and no API keys or accounts with anyone else are needed. Maps use [MapLibre GL JS](https://maplibre.org/) with free [OpenFreeMap](https://openfreemap.org/) basemaps (OpenStreetMap data). It contains no Esri code.

## Quick start

You need [Node.js](https://nodejs.org) **22.13 or newer**. Check with `node --version`.

```bash
git clone <this-repo-url> storymaps
cd storymaps
npm start
```

Open **http://localhost:5180**, create an account, and click **Start from sample** to explore.

`npm install` isn't needed, because there are no dependencies. Everything you create lives in the `data/` folder.

### Other ways to run it

| | |
|---|---|
| `npm run dev` | Restarts automatically when you edit server code |
| `npm test` | Runs the test suite against a temporary database |
| `docker compose up -d` | Runs in Docker, with data kept in a named volume |

### Settings

Copy `.env.example` to `.env` and edit it. Everything is optional.

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `5180` | Port to listen on |
| `HOST` | this computer only | Set to `0.0.0.0` to let other devices on your network connect |
| `APP_URL` | `http://localhost:PORT` | Your site's public address, used in password reset emails |
| `DATA_DIR` | `./data` | Where the database (`storymaps.db`) and uploaded images are stored |
| `COOKIE_SECURE` | off | Set to `1` when the site is served over HTTPS |
| `ALLOW_SIGNUP` | on | Set to `0` to stop new sign-ups once your accounts exist |
| `SMTP_*` | off | Email for password resets. See below |

### Password reset and email

People can reset a forgotten password from the sign-in page. To deliver the emails, set the `SMTP_*` settings in `.env`. Any SMTP provider works, for example Postmark, Resend, SendGrid, Mailgun, or a Gmail app password.

**Without email set up**, the reset link prints in the terminal where the server runs. That's fine for personal or local use. You can also reset passwords yourself from the command line:

```bash
npm run users                                 # list accounts
npm run reset-link -- someone@example.com     # print a reset link
npm run set-password -- someone@example.com   # type a new password directly
```

## Hosting it for others

Any machine or service that runs Node 22.13+ or Docker and has a persistent disk will work: a VPS, a home server, Fly.io, Railway, Render, and so on. Shared PHP-only web hosting won't.

1. Put it behind HTTPS. Caddy is the easiest: `caddy reverse-proxy --from stories.example.com --to localhost:5180`.
2. In `.env`, set `APP_URL=https://stories.example.com` and `COOKIE_SECURE=1`, plus `SMTP_*` if you want reset emails.
3. Once your own accounts exist, set `ALLOW_SIGNUP=0` if you don't want strangers signing up.
4. **Back up the `data/` folder.** It holds every story, account and image.

## What's included

| | |
|---|---|
| Story blocks | Cover and byline, text, quote, separator, image, video (YouTube, Vimeo, files), embed, interactive map |
| Sidecar | The map stays fixed while narrative cards scroll past and flies to each card's view. Cards can show an image, video or embed instead. Docked or floating layout |
| Map actions | Links in sidecar text that send the map to a different view, and back on a second click |
| Guided tour | Numbered places. Step through them or click a marker |
| Swipe | Compare two basemaps or two sets of layers with a draggable divider |
| Data layers | GeoJSON URL, uploaded GeoJSON or CSV, or a public ArcGIS FeatureServer/MapServer layer. Single color, color by category, or a color ramp, with labels, popups and a legend |
| Images | Upload or drag and drop. Resized in the browser to at most 2400px and saved as WebP, which also strips location metadata. Reusable "My images" library |
| Accounts | Sign up, sign in, change password, password reset by email or CLI |
| Publishing | Separate draft and published copies, custom links (`/s/your-story`), unpublish, and title and image previews when links are shared |

Not built yet: satellite imagery (it needs a licensed imagery provider), collaborators, collections, view counts, email verification, and deleting an account.

## Project layout

```
server.js              entry point + startup checks
server/index.js        HTTP server: API routes, uploads, published pages, static files
server/db.js           SQLite schema (built-in node:sqlite)
server/auth.js         password hashing, sessions, reset tokens, rate limiting
server/mail.js         minimal SMTP client
server/cli.js          admin commands
public/                the web app (plain ES modules, no build step)
  js/render.js         story → page; all block renderers
  js/maps.js           MapLibre helpers: basemaps, views, data layers, legend, popups
  js/builder.js        the editor
  stories/, data/      sample story and sample GeoJSON
docs/SCHEMA.md         the story file format
test/                  end-to-end API tests (node:test)
```

## API

Every request that changes data must send the header `X-StoryMaps: 1`. This guards against cross-site request forgery: another site can't add a custom header without a CORS preflight, and the server never allows one.

| | |
|---|---|
| `POST /api/auth/signup` `{email, password, name}` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/me` | Accounts |
| `POST /api/auth/forgot {email}` · `GET /api/auth/reset/:token` · `POST /api/auth/reset {token, password}` · `POST /api/auth/password {current, password}` | Password reset and change |
| `GET /api/stories` · `POST /api/stories {story}` | List and create your stories |
| `GET /api/stories/:id` · `PUT /api/stories/:id {story, version}` · `DELETE /api/stories/:id` | Read, save and delete a draft. A save with an outdated `version` returns `409` |
| `POST /api/stories/:id/publish {slug?}` · `POST /api/stories/:id/unpublish` | Publish copies the draft to the public copy |
| `GET /api/public/:slug` | A published story's JSON |
| `POST /api/uploads` (raw image body) · `GET /api/uploads` · `DELETE /api/uploads/:id` | Images: JPEG, PNG, WebP or GIF, checked by their bytes. 12 MB limit |

## Security

- **Passwords and sessions:** passwords are hashed with scrypt. Sessions are random tokens stored hashed, in an `HttpOnly; SameSite=Lax` cookie. Sign-in, sign-up and reset requests are rate-limited.
- **Password reset:** reset links are single-use and expire after an hour, and using one signs out every existing session. A reset request gets the same answer whether or not the email has an account. Links are always built from `APP_URL`, never from the request's Host header.
- **Story content:** story text is cleaned against an allow-list of HTML tags. Every page sends a Content-Security-Policy that only runs scripts from this site and unpkg, with no inline scripts.
- **Uploads:** uploaded files are checked by their contents, which rules out SVG, and served with `nosniff` and a `default-src 'none'` policy.

## Background

This project started as a rebuild of the ArcGIS StoryMaps reading and authoring experience. It was written from scratch using only public behavior and open formats. Esri's open-source classic templates ([Map Journal](https://github.com/Esri/storymap-journal), [Map Series](https://github.com/Esri/storymap-series), Apache-2.0) and [mapbox/storytelling](https://github.com/mapbox/storytelling) (BSD-3) were studied for data models and UX patterns only. No code was copied, and the current closed-source ArcGIS StoryMaps product was not used.
