# StoryMaps

A clean-room, open-source rebuild of the core ArcGIS StoryMaps experience: scroll-driven map stories with a visual builder.

No Esri code, SDK, or API key. Maps use [MapLibre GL JS](https://maplibre.org/) with free [OpenFreeMap](https://openfreemap.org/) vector basemaps (OpenStreetMap data).

## Run

```bash
node --disable-warning=ExperimentalWarning server.js
```

Then open http://localhost:5180 and create an account. There's nothing to install: the server uses only Node built-ins, including `node:sqlite` (Node 22.5 or later).

| Page | What it does |
|---|---|
| `/` | Your stories, with status (draft, published, or published with unpublished changes) |
| `/builder.html?id=…` | Editor with a live preview, autosave, image uploads and publishing |
| `/s/<slug>` | A published story. Public, with the title, description and cover image filled in for link previews |
| `/viewer.html?draft=<id>` | Owner-only preview of the current draft |
| `/login.html` | Sign in or create an account |

### Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `5180` | |
| `DATA_DIR` | `./data` | SQLite database (`storymaps.db`) and `uploads/` |
| `COOKIE_SECURE` | off | Set to `1` when serving over HTTPS |
| `ALLOW_SIGNUP` | on | Set to `0` to close new sign-ups once your accounts exist |

To back up, copy `DATA_DIR`. To deploy, you need a host that runs Node, such as a VPS, Fly.io, Railway or Render with a persistent disk. Shared PHP hosting won't work. Put it behind HTTPS (Caddy or nginx) and set `COOKIE_SECURE=1`.

## Feature map vs. ArcGIS StoryMaps

| ArcGIS StoryMaps | Here | Status |
|---|---|---|
| Cover, title, byline | Story `cover` and header | Done |
| Text, quote, separator, image, video, embed | Blocks of the same names | Done |
| Express or web map in the story | `map` block (view + markers) | Done |
| Sidecar (docked / floating), the Map Journal and Cascade scroll pattern | `sidecar` block; each slide sets its own map view or media and the map flies between them | Done |
| Guided tour (Map Tour) | `tour` block: numbered places, step through them or click a marker | Done |
| Swipe | `swipe` block: compare two basemaps with a draggable divider | Done |
| Map actions (inline links that change the map) | Sidecar slides: `#action:<id>` links fly the map to another view and toggle back when clicked again | Done |
| Data layers: GeoJSON, CSV, ArcGIS feature layers | Story-level layer library, turned on per map view. Styles: single color, color by category, color by number, plus labels, popups and a legend | Done |
| Swipe between layers | `swipe.leftLayers` / `rightLayers` | Done |
| Satellite imagery basemap | Needs a licensed imagery provider (e.g. MapTiler or Esri with a key) | Next |
| Accounts, drafts, publishing to a public link | Email and password accounts. Separate draft and published copies, publish and unpublish, custom links | Done |
| Image upload and media library | Drag and drop or pick a file. Resized in the browser to at most 2400px, re-encoded as WebP, which also strips EXIF/GPS data. Reusable "My images" library | Done |
| Collections, themes, collaborators, view counts | | Not built |

## Layout

```
server.js              entry point
server/index.js        HTTP server: API routes, uploads, published pages, static files
server/db.js           SQLite schema (users, sessions, stories, uploads)
server/auth.js         scrypt password hashing, cookie sessions, rate limiting
public/
  js/render.js         story JSON -> DOM; all block renderers
  js/maps.js           MapLibre helpers: basemaps, views, markers, data layers, legend, popups
  js/csv.js            CSV parser and lat/long-to-GeoJSON conversion
  js/builder.js        editor UI, map-view picker, import/export
  js/api.js            API client and browser-side image resizing
  js/store.js          legacy browser drafts (offered for import into an account)
  js/sanitize.js       allow-list HTML sanitizer for author text
  stories/potomac.json sample story
  data/                sample GeoJSON
docs/SCHEMA.md         story document format
_reference/            cloned open-source projects (git-ignored, read-only reference)
```

## References

`_reference/` holds shallow clones used only to study data models and UX patterns. No code was copied from them.

- `Esri/storymap-journal`, `Esri/storymap-series`: Esri's classic templates, Apache-2.0
- `mapbox/storytelling`: BSD-3-Clause

The current ArcGIS StoryMaps product is closed source and was not used.

## Data layers

A layer's source can be any of:

- **A GeoJSON URL.** It must allow cross-origin requests (CORS).
- **A public ArcGIS REST layer URL**, ending in `/FeatureServer/<n>` or `/MapServer/<n>`. It's queried as GeoJSON with `f=geojson` and paged through the server's record limit, up to 20,000 features. Secured services that need a token aren't supported.
- **An uploaded `.geojson` or `.csv` file.** A CSV needs latitude and longitude columns, named `lat`/`latitude`/`y` and `lon`/`lng`/`longitude`/`x`. Uploaded data is stored inline in the story, and browser storage holds about 5 MB in total.

Data is fetched only when a layer is first shown, and each URL is cached across maps.

## API

Every request that changes data must send the header `X-StoryMaps: 1`. This is CSRF protection: a cross-site page can't add a custom header without a CORS preflight, and the server never allows one.

| | |
|---|---|
| `POST /api/auth/signup` `{email, password, name}` / `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/me` | Accounts |
| `GET /api/stories` / `POST /api/stories {story}` | List and create your stories |
| `GET /api/stories/:id` / `PUT /api/stories/:id {story, version}` / `DELETE /api/stories/:id` | Draft read, save and delete. A save with an outdated `version` returns `409` |
| `POST /api/stories/:id/publish {slug?}` / `POST /api/stories/:id/unpublish` | Publish copies the draft to the public copy |
| `GET /api/public/:slug` | The published story's JSON |
| `POST /api/uploads` (raw image body) / `GET /api/uploads` / `DELETE /api/uploads/:id` | Images. The type is checked from the file's bytes (JPEG, PNG, WebP or GIF only, so no SVG). 12 MB limit |

## Security notes

- Passwords are hashed with scrypt. Sessions are random tokens, stored hashed, in an `HttpOnly; SameSite=Lax` cookie. Sign-in and sign-up are limited to 10 attempts per 10 minutes per IP, and the limit resets when the server restarts.
- Story text is cleaned against an allow-list of HTML tags when it's displayed. Pages also send a Content-Security-Policy that only runs scripts from this site and unpkg (no inline scripts), so a bad story can't run code.
- Uploads are served with `nosniff` and a `default-src 'none'` policy.
- Not built yet: password reset (it needs email sending), email verification, and deleting an account.
