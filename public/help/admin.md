# For administrators

This page is for the person who installs and runs Waymark for an organization. Waymark is self-hosted: all stories, maps, layers, accounts and uploads live on your server, in one data folder.

## Install

Waymark needs **Node.js 22.13 or newer**, or **Docker**. It has no other dependencies and no build step.

**With Node.js**

```bash
git clone https://github.com/chrispy90/waymark.git
cd waymark
node server.js
```

**With Docker**

```bash
git clone https://github.com/chrispy90/waymark.git
cd waymark
docker compose up -d
```

Then open `http://localhost:5180`. The first account you create can always sign up, even if sign-ups are closed.

Docker keeps data in a named volume (`waymark-data`). Without Docker, data is in the `data/` folder next to `server.js`.

## Put it on the web

1. **Serve it over HTTPS.** Put Waymark behind a reverse proxy such as Caddy, nginx or your cloud provider's load balancer. With Caddy: `caddy reverse-proxy --from stories.example.org --to localhost:5180`.
2. **In `.env`**, set `APP_URL=https://stories.example.org` and `COOKIE_SECURE=1`.
3. **Set `HOST=0.0.0.0`** if the proxy runs on another machine (Docker already does this).
4. **Close sign-ups** once your accounts exist: `ALLOW_SIGNUP=0`.
5. **Back up the data folder** regularly. See [Backups](#backups).

## Settings

Copy `.env.example` to `.env` next to `server.js` and edit it, or pass environment variables. Restart Waymark after changing settings.

| Setting | Default | What it does |
| --- | --- | --- |
| `APP_NAME`, `APP_TAGLINE` | Waymark | Rename the app in the interface, emails and link previews. |
| `PORT` | `5180` | Port to listen on. |
| `HOST` | `127.0.0.1` | Network interface. Use `0.0.0.0` to accept connections from other machines. |
| `APP_URL` | `http://localhost:PORT` | Your public address, used in password reset emails. Never taken from the request. |
| `DATA_DIR` | `./data` | Where the database, uploads and hosted layer files are kept. |
| `COOKIE_SECURE` | off | `1` when served over HTTPS. |
| `ALLOW_SIGNUP` | on | `0` stops new accounts (after the first). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | off | Email for password resets. See [Email](#email). |
| `MAX_LAYER_MB` | `256` | Largest hosted layer upload or edit. |
| `TILE_THRESHOLD` | `20000` | Hosted layers with more features than this are drawn from vector tiles. |
| `ROUTING_URL` | public Valhalla demo | Routing server for routes and travel-time areas. See [Routing](#routing). |
| `ALLOW_PRIVATE_FETCH` | off | `1` lets scheduled refresh and map-service lookups reach private network addresses. See [Security](#security). |

## Accounts

People create their own accounts while sign-ups are open. To manage accounts from the server's command line:

| Command | What it does |
| --- | --- |
| `node server.js users` | List accounts. |
| `node server.js stories` | List all stories with their owners and links. |
| `node server.js reset-link <email>` | Print a one-time password reset link (valid 60 minutes). |
| `node server.js set-password <email>` | Set a new password, typed at the terminal. Signs the account out everywhere. |

With Docker, prefix commands with `docker compose exec waymark`, for example `docker compose exec waymark node server.js users`.

People change their own password from the account menu, which signs out their other devices.

## Email

Without email settings, password reset links are printed in the server's log instead of sent. To send them, set the `SMTP_*` settings for any provider (Postmark, Resend, SendGrid, Mailgun, Amazon SES, or a Gmail app password):

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=secret
SMTP_FROM="Waymark <no-reply@example.org>"
SMTP_SECURE=starttls   # or tls for port 465
```

## Routing

[Route along roads](analysis-tools.md#route-along-roads) and [Travel-time areas](analysis-tools.md#travel-time-areas) call a [Valhalla](https://github.com/valhalla/valhalla) routing server from the user's browser. The default, `https://valhalla1.openstreetmap.de`, is a free public server run by volunteers with a fair-use policy; it's fine for trying the tools but not for regular use.

For regular use, run your own Valhalla server (Docker images are available, built from OpenStreetMap extracts for your region) and set `ROUTING_URL` to its address. It must be reachable from users' browsers and allow cross-origin requests.

## Backups

Everything is in the data folder (`DATA_DIR`, or the `waymark-data` Docker volume):

| Path | Contents |
| --- | --- |
| `waymark.db` (with `-wal` and `-shm`) | Accounts, stories, maps, dashboards, forms, groups, sharing, layer metadata. |
| `uploads/` | Uploaded images and form photos. |
| `layers/` | Hosted layer data, and their earlier versions. |

To back up, copy the whole folder. For a copy that's guaranteed consistent, stop Waymark briefly or use SQLite's backup command on `waymark.db`. To restore, put the folder back and start Waymark.

## Upgrade

```bash
git pull
node server.js            # or: docker compose up -d --build
```

The database upgrades itself on start. Back up the data folder before upgrading. The [changelog](https://github.com/chrispy90/waymark/blob/main/CHANGELOG.md) lists what changed in each version.

## Security

- Passwords are hashed with scrypt. Sessions are random tokens in HTTP-only cookies; sign-in, sign-up, password reset and form submissions are rate-limited.
- Every write request needs a custom header that other websites can't send, which blocks cross-site request forgery.
- Story text is sanitized, and pages use a strict Content-Security-Policy.
- Uploaded images are checked by their contents, not their names.
- Access to every story, map, layer and dashboard is checked on the server for each request. Items that aren't shared with someone answer "not found".
- Scheduled layer refresh and map-service lookups fetch addresses typed by signed-in users. They refuse private, loopback and link-local addresses unless `ALLOW_PRIVATE_FETCH=1`, re-check redirects and cap response sizes. On a server inside a sensitive network, keep sign-ups closed.
- Public forms accept submissions from anyone with the link, checked against the form's questions and rate-limited.

Report security problems privately as described in the project's `SECURITY.md`.

## Help center

These help pages are served at `/help` from Markdown files in `public/help/`. To add your organization's own guidance, edit those files or add pages and list them in `public/js/help.js`; changes appear after a reload, with no rebuild.
