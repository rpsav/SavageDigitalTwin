import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'twin.db');

export const EMBEDDING_DIM = 768; // nomic-embed-text

function openDb(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      context_json    TEXT,
      created_at      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id            TEXT PRIMARY KEY,
      text          TEXT NOT NULL,
      source_msg_id TEXT,
      created_at    INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
      memory_id TEXT PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    );
  `);

  return db;
}

// Lazy singleton — only opens the DB on first real use (not at build/import time),
// cached on globalThis to survive Next.js hot reloads.
const g = globalThis as unknown as { __twinDb?: Database.Database };

export function getDb(): Database.Database {
  return g.__twinDb ?? (g.__twinDb = openDb());
}
