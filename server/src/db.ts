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

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
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
