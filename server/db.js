// SQLite persistence via Node's built-in node:sqlite (no dependencies).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const LAYER_DIR = path.join(DATA_DIR, 'layers');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LAYER_DIR, { recursive: true });

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
  -- Hosted feature layers: GeoJSON FeatureCollections stored on disk with schema, attribution and default styling.
  CREATE TABLE IF NOT EXISTS layers (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    attribution TEXT NOT NULL DEFAULT '',
    geom_type TEXT NOT NULL DEFAULT 'mixed',
    feature_count INTEGER NOT NULL DEFAULT 0,
    fields TEXT NOT NULL DEFAULT '[]',
    style TEXT NOT NULL DEFAULT '{}',
    popup TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    shared INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS layers_owner ON layers(owner_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  -- Teams: groups of accounts, and who an item (story, map, layer, dashboard) is shared with.
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS shares (
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL,
    group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS shares_item ON shares(item_type, item_id);
  CREATE INDEX IF NOT EXISTS shares_user ON shares(user_id);
  CREATE INDEX IF NOT EXISTS shares_group ON shares(group_id);
  -- Earlier states of a hosted layer, kept on disk as <id>.v<version>.geojson so edits can be undone.
  CREATE TABLE IF NOT EXISTS layer_versions (
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    saved_at INTEGER NOT NULL,
    saved_by TEXT,
    note TEXT NOT NULL DEFAULT '',
    feature_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (layer_id, version)
  );
  -- Dashboards: a saved map plus charts, numbers and filters that work on each other.
  CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    shared INTEGER NOT NULL DEFAULT 0,
    listed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dashboards_owner ON dashboards(owner_id, updated_at DESC);
  -- Scenarios: units on a map, played turn by turn, with branches for "what if" alternatives.
  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    shared INTEGER NOT NULL DEFAULT 0,
    listed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scenarios_owner ON scenarios(owner_id, updated_at DESC);
  -- Public forms that add points to a hosted layer.
  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    open INTEGER NOT NULL DEFAULT 1,
    submissions INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS forms_layer ON forms(layer_id);
`);

// Columns added after the first release. SQLite has no "ADD COLUMN IF NOT EXISTS".
const addColumn = (table, column, type) => {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
};
addColumn('users', 'handle', 'TEXT');
addColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''");
addColumn('stories', 'listed', 'INTEGER NOT NULL DEFAULT 0');
addColumn('maps', 'listed', 'INTEGER NOT NULL DEFAULT 0');
addColumn('layers', 'updated_by', 'TEXT');
addColumn('layers', 'source_url', "TEXT NOT NULL DEFAULT ''");
addColumn('layers', 'refresh_minutes', 'INTEGER NOT NULL DEFAULT 0');
addColumn('layers', 'refreshed_at', 'INTEGER');
addColumn('layers', 'refresh_error', "TEXT NOT NULL DEFAULT ''");
addColumn('layers', 'bbox', 'TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users(handle COLLATE NOCASE) WHERE handle IS NOT NULL');

module.exports = { db, DATA_DIR, UPLOAD_DIR, LAYER_DIR };
