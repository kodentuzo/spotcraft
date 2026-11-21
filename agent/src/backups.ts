import { spawn } from 'node:child_process'

/*
 * Nightly backups of every app to an S3-compatible bucket (ADR 0030): its settings
 * (`app.json`, `secrets.json`) and, for an app with a database, a `pg_dump` of it.
 */

/** Where the last backup of an app stands, kept as `apps/<name>/backup.json`. */
export interface BackupStatus {
  /** When the last attempt finished (ISO). */
  at: string
  ok: boolean
  /** The backup's folder in the bucket, `<name>/<time>/`, when it worked. */
  key?: string
  /** Size of the database dump; 0 for an app without a database. */
  bytes?: number
  /** Why it failed. */
  error?: string
  /** When a backup last worked, failed attempts since included. */
  lastOkAt?: string
}

/** The bucket: puts objects, and reads them back to restore. */
export interface BackupTarget {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>
  /** One object; refuses one larger than `maxBytes`. */
  get(key: string, maxBytes: number): Promise<Buffer>
  /** The folders right under `prefix`, such as `blog/20261114T030000Z/`. */
  folders(prefix: string): Promise<string[]>
}

/**
 * Puts one app's schema back from a dump (ADR 0043). Throws if it can't; the schema is then as
 * it was.
 */
export type Restore = (app: string, dump: Buffer) => Promise<void>

/** Dumps one app's schema (or its own database, from before ADR 0034), in pg_dump's custom format. */
export type Dump = (app: string) => Promise<Buffer>

/**
 * A dump larger than this fails. It is held in memory, twice at the end (the chunks and the
 * joined buffer), and the agent has 256 MB.
 */
export const MAX_DUMP_BYTES = 32 * 1024 * 1024

/** How long one dump may take, inside the container too (`timeout`), so it never lingers. */
const DUMP_SECONDS = 300

/**
 * `pg_dump` inside the Postgres container, as the superuser over its local socket (peer auth,
 * `infra/server/pg_hba.conf`): the agent's own role doesn't own the apps' tables. It gives up
 * on a table lock after 30 s rather than wait behind a migration, and on the whole dump after
 * DUMP_SECONDS, killed inside the container as well as here.
 */
export function dockerDump(
  postgresContainer: string,
  /** Where the app's tables are: a schema of the instance database, or its own database. */
  target: (app: string) => Promise<{ database: string; schema?: string }>,
  timeoutMs = (DUMP_SECONDS + 15) * 1000,
): Dump {
  return async (app) => {
    const { database, schema } = await target(app)
    const what = schema ? `${database}.${schema}` : database
    return new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          postgresContainer,
          'timeout',
          String(DUMP_SECONDS),
          'pg_dump',
          '-U',
          'postgres',
          '--format=custom',
          '--lock-wait-timeout=30s',
          ...(schema ? [`--schema=${schema}`] : []),
          database,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      let failure: Error | undefined
      const timer = setTimeout(() => {
        failure = new Error(`pg_dump of ${what} took longer than ${timeoutMs / 1000} s`)
        child.kill()
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_DUMP_BYTES) {
          failure ??= new Error(
            `The dump of ${what} is larger than ${MAX_DUMP_BYTES / 1024 / 1024} MB, which the agent holds in memory`,
          )
          child.kill()
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (failure) reject(failure)
        else if (code !== 0) reject(new Error(`pg_dump of ${what} failed: ${stderr.trim()}`))
        else resolve(Buffer.concat(chunks))
      })
    })
  }
}

/** `20261114T030000Z`: sorts by time, and needs no encoding in a key. */
export const backupStamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '')

/** Milliseconds until the next `hour`:00 UTC after `now`. */
export function untilNext(hour: number, now = new Date()): number {
  const next = new Date(now)
  next.setUTCHours(hour, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime() - now.getTime()
}

/** Where the schema being replaced waits during a restore; one restore runs at a time. */
export const RESTORE_OLD_SCHEMA = 'spotcraft_restore_old'

/** Placeholders' emails end in this; `.invalid` is a name that can never be real (RFC 2606). */
const PLACEHOLDER = '@restore.invalid'

/** Runs a command inside a container, with `input` on stdin; rejects with its stderr. */
function execIn(
  container: string,
  args: string[],
  input: string | Buffer,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let failure: Error | undefined
    const timer = setTimeout(() => {
      failure = new Error(`${args[0]} took longer than ${timeoutMs / 1000} s`)
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-2000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(stderr.trim() || `${args[0]} failed`))
      else resolve(stdout)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/**
 * Restores one app's schema of `database` inside the Postgres container, as the superuser over
 * its local socket, like `dockerDump`:
 *
 * 1. The live schema is renamed to RESTORE_OLD_SCHEMA and an empty one made for the app's role.
 * 2. Users deleted since the backup (`auth.deletions`, kept as long as backups) are put back as
 *    placeholders, so the dump's foreign keys to `auth.users` hold.
 * 3. `pg_restore` runs in one transaction as the app's role, so a dump can do no more than the
 *    app could, and only objects in the app's schema are restored (`-n`).
 * 4. The placeholders are deleted, which deletes the restored rows that were theirs through the
 *    app's cascading keys, and the old schema is dropped. Their deletion times are kept.
 *
 * If `pg_restore` fails, nothing of it stays: the empty schema is dropped and the old one gets
 * its name back.
 */
export function dockerRestore(
  postgresContainer: string,
  database: string,
  /** The app's role, which is also its schema's name (ADR 0034). */
  schemaOf: (app: string) => string,
  timeoutMs = (DUMP_SECONDS + 15) * 1000,
): Restore {
  const psql = (sql: string) =>
    execIn(
      postgresContainer,
      ['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q'],
      sql,
      60_000,
    )
  const dropPlaceholders = `
    CREATE TEMP TABLE placeholders ON COMMIT DROP AS
      SELECT d.user_id, d.deleted_at FROM auth.deletions d
      JOIN auth.users u ON u.id = d.user_id AND u.email = d.user_id::text || '${PLACEHOLDER}';
    DELETE FROM auth.users WHERE id IN (SELECT user_id FROM placeholders);
    UPDATE auth.deletions d SET deleted_at = p.deleted_at FROM placeholders p
      WHERE d.user_id = p.user_id;`

  return async (app, dump) => {
    const schema = schemaOf(app)
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`${schema} is not a schema name`)
    const name = `"${schema}"`
    await psql(`
      DO $$ BEGIN
        IF to_regnamespace('${RESTORE_OLD_SCHEMA}') IS NOT NULL THEN
          RAISE EXCEPTION 'The schema ${RESTORE_OLD_SCHEMA} is left from an earlier restore; check it, then drop it';
        END IF;
      END $$;
      BEGIN;
      ALTER SCHEMA ${name} RENAME TO ${RESTORE_OLD_SCHEMA};
      CREATE SCHEMA ${name} AUTHORIZATION ${name};
      INSERT INTO auth.users (id, email, is_anonymous, created_at, updated_at)
        SELECT d.user_id, d.user_id::text || '${PLACEHOLDER}', true, 'epoch', 'epoch'
        FROM auth.deletions d
        WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.user_id);
      COMMIT;`)
    try {
      await execIn(
        postgresContainer,
        [
          'timeout',
          String(DUMP_SECONDS),
          'pg_restore',
          '-U',
          'postgres',
          '-d',
          database,
          '-n',
          schema,
          `--role=${schema}`,
          '--no-owner',
          '--no-privileges',
          '--single-transaction',
          '--exit-on-error',
        ],
        dump,
        timeoutMs,
      )
    } catch (error) {
      await psql(`BEGIN; ${dropPlaceholders}
        DROP SCHEMA ${name} CASCADE;
        ALTER SCHEMA ${RESTORE_OLD_SCHEMA} RENAME TO ${name};
        COMMIT;`)
      throw error
    }
    await psql(`BEGIN; ${dropPlaceholders}
      DROP SCHEMA ${RESTORE_OLD_SCHEMA} CASCADE;
      COMMIT;`)
  }
}
