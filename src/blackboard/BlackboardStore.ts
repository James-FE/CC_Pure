import { Database } from 'bun:sqlite'
import { dirname } from 'path'
import { mkdirSync } from 'fs'
import type { BlackboardEntry } from './BlackboardTypes.js'

type BlackboardRow = {
  key: string
  value: string
  version: number
  updated_at: string
  updated_by: string
}

function mapRow(row: BlackboardRow): BlackboardEntry {
  return {
    key: row.key,
    value: row.value,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

function ensureParentDirectory(path: string): void {
  if (path === ':memory:') return

  const parent = dirname(path)
  if (parent === '.' || parent === '') return

  mkdirSync(parent, { recursive: true })
}

export function open(path: string): Database {
  ensureParentDirectory(path)

  const db = new Database(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS blackboard (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT NOT NULL
    );
  `)
  return db
}

export function set(
  db: Database,
  key: string,
  value: string,
  writer: string,
): void {
  db.query(
    `
      INSERT INTO blackboard (key, value, version, updated_at, updated_by)
      VALUES ($key, $value, 1, datetime('now'), $writer)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        version = blackboard.version + 1,
        updated_at = datetime('now'),
        updated_by = excluded.updated_by
    `,
  ).run({ $key: key, $value: value, $writer: writer })
}

export function get(db: Database, key: string): BlackboardEntry | null {
  const row = db
    .query<BlackboardRow, { $key: string }>(
      `
        SELECT key, value, version, updated_at, updated_by
        FROM blackboard
        WHERE key = $key
      `,
    )
    .get({ $key: key })

  return row ? mapRow(row) : null
}

export function getByPrefix(db: Database, prefix: string): BlackboardEntry[] {
  return db
    .query<BlackboardRow, { $prefix: string }>(
      `
        SELECT key, value, version, updated_at, updated_by
        FROM blackboard
        WHERE key LIKE $prefix || '%'
        ORDER BY key ASC
      `,
    )
    .all({ $prefix: prefix })
    .map(mapRow)
}

export function deleteKey(db: Database, key: string): void {
  db.query('DELETE FROM blackboard WHERE key = $key').run({ $key: key })
}

export { deleteKey as delete }

export function deleteByPrefix(db: Database, prefix: string): void {
  db.query("DELETE FROM blackboard WHERE key LIKE $prefix || '%'").run({
    $prefix: prefix,
  })
}

export function close(db: Database): void {
  db.close()
}
