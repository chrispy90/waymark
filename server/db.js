// SQLite persistence via Node's built-in node:sqlite (no dependencies).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'waymark.db');
// One-time rename from the project's earlier name.
const LEGACY = path.join(DATA_DIR, 'storymaps.db');
if (!fs.existsSync(DB_FILE) && fs.existsSync(LEGACY)) {
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(LEGACY + ext)) fs.renameSync(LEGACY + ext, DB_FILE + ext);
}

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    draft TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    published TEXT,
    slug TEXT UNIQUE,
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stories_owner ON stories(owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(owner_id, created_at DESC);
  -- Saved maps: layers, basemap, starting view and bookmarks, reusable in any number of stories.
  -- shared = 1 once a published story uses the map, which lets readers load it.
  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    shared INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS maps_owner ON maps(owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
`);

module.exports = { db, DATA_DIR, UPLOAD_DIR };
