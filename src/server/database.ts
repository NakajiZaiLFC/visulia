import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, fchmodSync, fstatSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path: string): DatabaseSync {
  const file = resolve(path);
  const parent = dirname(file);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = statSync(parent);
  if ((directory.mode & 0o077) !== 0 || directory.uid !== process.getuid?.()) {
    throw new Error('DATABASE_DIRECTORY_NOT_PRIVATE');
  }
  const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.()) throw new Error('INVALID_DATABASE_FILE');
    fchmodSync(fd, 0o600);
  } finally { closeSync(fd); }
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS resources (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('planned','created','removed')),
        PRIMARY KEY(kind, name)
      ) STRICT;
    `);
    return db;
  } catch (error) { db.close(); throw error; }
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
