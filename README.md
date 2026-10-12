# Waymark

**Stories with a sense of place.** Self-hosted, scroll-driven map stories with a visual editor.

- **Write a story** from blocks: text, images, video, embeds, maps, scrolling map "sidecars", guided tours, and swipe comparisons.
- **Bring your data**: GeoJSON, CSV, or public ArcGIS feature layers, styled by category or value, with popups and a legend.
- **Use live public data**: one click adds layers from NOAA, NASA, USGS, the Census Bureau, the Park Service, EPA, wildfire agencies and more, or search thousands of public layers on ArcGIS Online.
- **Filter it**: magnitude ≥ 5, "in the last 7 days", state = Texas. Filters apply to the map, the analysis and the export.
- **Analyze it**: buffers, hex bins, counts per area, distance to nearest, heatmaps and clusters, plus drawing and measuring tools. Results become layers you can put in any map.
- **Make it move**: chapters that recolor the page, statements that light up word by word, numbers that count up, galleries that slide sideways, and parallax photos.
- **Publish it** to a public link. Draft edits stay private until you publish again.

There's nothing to install beyond Node.js, and no API keys or accounts with anyone else are needed. Maps use [MapLibre GL JS](https://maplibre.org/) with free [OpenFreeMap](https://openfreemap.org/) basemaps (OpenStreetMap data). It contains no Esri code.

## Quick start

You need [Node.js](https://nodejs.org) **22.13 or newer**. Check with `node --version`.

```bash
git clone <this-repo-url> waymark
cd waymark
npm start
```

Open **http://localhost:5180**. The first visit asks you to create the owner account. Then pick a template. **Immersive essay** shows off every scroll effect, and **Sample: Down the Potomac** shows the map features.

`npm install` isn't needed, because there are no dependencies. Everything you create lives in the `data/` folder.

> **Windows:** if PowerShell says *"running scripts is disabled on this system"*, use `node server.js` instead of `npm start`. It does the same thing. `npm.cmd start` also works.

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
| `APP_NAME`, `APP_TAGLINE` | Waymark | Rename the app (interface, emails, link previews) |
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

## Exporting a story to host anywhere

Don't want to run Waymark on your server? Export a finished story as a plain static website. It needs no Node, no database and no Waymark, just a web server.

In the editor, open **⋯ → Export as a website** (or use the **⋯** menu on a story card in the gallery) and pick a format:

| Format | Use it for |
|---|---|
| **Website folder (.zip)** | Apache, nginx, IIS, shared hosting, Amazon S3, GitHub Pages, Netlify, or double-clicking `index.html` on your own computer |
| **Tomcat web app (.war)** | Copy it into Tomcat's `webapps/` folder. It's served at `http://your-server:8080/<story-name>/`, or rename it `ROOT.war` to serve it at the site root. Works on Tomcat 8.5 to 11 |

The export contains the page, a bundled copy of the story reader (one plain script), the styles, your images, and a snapshot of your map data. You can also include the map library (MapLibre) so nothing loads from a CDN. All paths are relative, so it works in any sub-folder or context path. Only the map tiles and web fonts still load from the internet.

You can export from the command line too, which is handy for scripted deploys:

```bash
node server.js stories                                    # find the story's link or id
node server.js export my-story --war --out /opt/tomcat/webapps/my-story.war
node server.js export my-story --draft                    # the unpublished draft, as a .zip
```

Options: `--war`, `--draft`, `--out <file>`, `--no-images`, `--no-data` and `--no-vendor` (keep images, data or the map library as links instead of copying them).

## What's included

| | |
|---|---|
| Story blocks | Cover and byline, text, quote, divider, image, video (YouTube, Vimeo, files), embed, interactive map |
| Scroll effects | **Chapter**: full-screen title that recolors the page from there on. **Statement**: huge text that lights up word by word. **Big numbers**: figures that count up. **Scroll gallery**: photos that slide sideways as you scroll down. **Image motion**: parallax, zoom or wipe-in reveal. **Cover motion**: parallax or zoom. A story-wide **scroll animation** setting (off, subtle or expressive) fades blocks in. Everything turns off for readers who ask their device to reduce motion |
| Editor | Click anything in the live preview to edit it. Visual block picker, drag to reorder, full undo and redo, a command palette (Ctrl/Cmd+K), keyboard shortcuts (press ?), desktop/phone preview, autosave |
| Geospatial analysis | In the Data tab, **Analyze** previews every result on a map before adding it. **Buffer**: zones around features, optionally merged. **Hex bins**: count, sum or average points per hexagon. **Count in areas**: a point-in-polygon spatial join. **Distance to nearest**: a field with the distance to the closest feature in another layer. **Within distance**: proximity filter. **Center points**, **outline** (convex hull) and **filter by attribute**. Results are saved as ordinary layers and remember how they were made, so you can re-run them on fresh data |
| Public data catalog | **Browse public data** in the Data tab or in any map's editor. Featured sources, all keyless and browser-ready: **USGS** earthquakes (live) and stream gauges by state. **NOAA** weather warnings (live), radar (live), tide stations, historical tsunamis, significant earthquakes, volcanoes, eruptions and plate boundaries. **NASA** natural events (EONET), daily satellite imagery and Earth at night. **Census** states and counties. **NPS** park units, **USFS** national forests, **EPA** Superfund sites, **NIFC** active wildfires and perimeters, and **Natural Earth** countries, cities and rivers. **Search more** finds public layers on ArcGIS Online. Each layer comes styled, with popups and source credits |
| Filters | Per-layer rules (`=`, `≠`, `>`, `≥`, `<`, `≤`, contains, in the last N days, empty or not empty), matching all or any. They apply to the map, insights, analysis and export, and show "X of Y features" |
| Basemaps | Streets, bright, light, dark, **satellite** (Sentinel-2 cloudless, global), **USGS imagery** and **USGS topo** (US) |
| Data tools | **Draw & measure**: sketch points, routes and areas with live distance and area, then save them as a layer. **Insights**: feature count, total area or length, field histograms and top values, with one click to turn them into a Big numbers block. **Heatmap** and **cluster** display for point layers. Add data by dropping files, pasting a link, or using sample data |
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
server/brand.js        app name and tagline
public/                the web app (plain ES modules, no build step)
  js/render.js         story → page; all block renderers
  js/effects.js        scroll-driven effects engine (one rAF loop, on-screen elements only)
  js/ui.js             icons, logo, toasts, menus, dialogs
  js/maps.js           MapLibre helpers: basemaps, views, data layers (incl. heatmap/clusters), legend, popups
  js/analysis.js       geospatial tools and layer statistics (Turf.js, loaded only in the editor)
  js/workbench.js      Add data, Analyze and Draw & measure workspaces
  js/catalog.js        public data catalog (government sources + ArcGIS Online search)
  js/export-core.js    static-site / .war exporter (shared by the editor and `node server.js export`)
  js/export.js         the export dialog
  js/zip.js            minimal zip writer
  js/builder.js        the editor
  js/templates.js      starter templates
  welcome.html         landing page for signed-out visitors (itself a story)
  stories/, data/      sample story and sample GeoJSON
docs/SCHEMA.md         the story file format
test/                  end-to-end API tests (node:test)
```

## API

Every request that changes data must send the header `X-Waymark: 1`. This guards against cross-site request forgery: another site can't add a custom header without a CORS preflight, and the server never allows one.

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
