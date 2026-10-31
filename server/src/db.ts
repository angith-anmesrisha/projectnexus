import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  accent        TEXT NOT NULL DEFAULT '#7c5cff',
  status        TEXT NOT NULL DEFAULT 'online',  -- online | idle | dnd | invisible
  now_playing   TEXT NOT NULL DEFAULT '',
  lfg           INTEGER NOT NULL DEFAULT 0,      -- looking for teammates
  games         TEXT NOT NULL DEFAULT '[]',      -- JSON array of game names
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- A friendship row exists from the moment a request is sent.
CREATE TABLE IF NOT EXISTS friendships (
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,  -- user | message
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS communities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  game        TEXT NOT NULL DEFAULT '',
  accent      TEXT NOT NULL DEFAULT '#22d3ee',
  owner_id    TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS community_members (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (community_id, user_id)
);

-- Community channels and direct conversations share one table so that
-- messaging and its permission checks have a single code path.
CREATE TABLE IF NOT EXISTS channels (
  id           TEXT PRIMARY KEY,
  community_id TEXT REFERENCES communities(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,  -- text | announcement | dm | group
  name         TEXT NOT NULL DEFAULT '',
  topic        TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL
);

-- Membership for dm / group channels only. Community channel access comes
-- from community_members.
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  content     TEXT NOT NULL,
  reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  edited_at   INTEGER,
  deleted_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
`;

const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file       TEXT NOT NULL,     -- file name on disk
  mime       TEXT NOT NULL,
  name       TEXT NOT NULL,     -- original file name
  size       INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gif_favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  preview    TEXT NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, url)
);

CREATE TABLE IF NOT EXISTS user_stickers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Community-shared appearance themes, like a theme store.
CREATE TABLE IF NOT EXISTS themes (
  id          TEXT PRIMARY KEY,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL,   -- JSON appearance settings, including any custom CSS
  installs    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
`;

const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,   -- mention | reply | friend_request | friend_accept | event
  actor_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  community_id TEXT REFERENCES communities(id) ON DELETE CASCADE,
  channel_id   TEXT REFERENCES channels(id) ON DELETE CASCADE,
  message_id   INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  event_id     TEXT,
  text         TEXT NOT NULL DEFAULT '',
  read_at      INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);

-- Custom community roles. Permissions are a bit set, see PERMS in access.ts.
CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '',
  permissions  INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0,
  hoist        INTEGER NOT NULL DEFAULT 0,  -- show members with this role in their own group
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_roles (
  role_id      TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT '',
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_community ON events(community_id, starts_at);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status   TEXT NOT NULL,  -- going | interested
  PRIMARY KEY (event_id, user_id)
);
`;

/** Add a column if an older database does not have it yet. */
function addColumn(db: DB, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec(SCHEMA_V2);
  addColumn(db, 'users', 'prefs', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'users', 'avatar_url', 'TEXT');
  addColumn(db, 'users', 'banner_url', 'TEXT');
  addColumn(db, 'messages', 'attachments', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'messages', 'sticker', 'TEXT');
  db.exec(SCHEMA_V3);
  // Forum posts are channels of kind 'thread' that point at their forum.
  addColumn(db, 'channels', 'parent_id', 'TEXT REFERENCES channels(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS channels_parent ON channels(parent_id)');
  return db;
}

/** Run fn inside a transaction, rolling back if it throws. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
