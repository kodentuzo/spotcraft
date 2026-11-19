import pg from 'pg'
import { deleteIdleGuests } from './cleanup.ts'
import { loadConfig } from './config.ts'
import { migrate } from './migrate.ts'
import { createPool } from './pool.ts'
import { createAuthServer } from './server.ts'

const config = loadConfig()
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  process.stdout.write(
    `${JSON.stringify({ level, msg, time: new Date().toISOString(), ...extra })}\n`,
  )

const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
// A pooled connection that breaks while idle is reported here; with no listener it would crash.
db.on('error', (error) => log('warn', 'Postgres connection lost', { error: error.message }))

let migrated = false
const ready = async () => {
  if (!migrated) return false
  await db.query('SELECT 1')
  return true
}

const server = createAuthServer(createPool(config, db), config, ready)
server.listen(config.port, config.host, () => log('info', 'listening', { port: config.port }))

// Postgres may still be starting (both start in the same deploy), so migrating is retried for a
// few minutes; until then /health answers 503 and the pool's routes fail.
for (let attempt = 1; ; attempt++) {
  const client = await db.connect().catch((error: Error) => error)
  if (!(client instanceof Error)) {
    try {
      const { from, to } = await migrate(client, config.appGroup)
      migrated = true
      log('info', 'auth schema up to date', { from, to })
      break
    } catch (error) {
      if (attempt === 36) throw error
      log('warn', 'could not migrate the auth schema; retrying', { error: String(error) })
    } finally {
      client.release()
    }
  } else if (attempt === 36) {
    throw client
  }
  await new Promise((resolve) => setTimeout(resolve, 5000))
}

// Once a day, delete guests nobody has used for AUTH_GUEST_DAYS.
const cleanUp = async () => {
  try {
    const { deleted, blocked } = await deleteIdleGuests(db, config.guestDays)
    if (deleted || blocked.length)
      log(blocked.length ? 'warn' : 'info', 'idle guests', { deleted, blocked })
  } catch (error) {
    log('error', 'could not delete idle guests', { error: String(error) })
  }
}
await cleanUp()
const timer = setInterval(cleanUp, 24 * 60 * 60 * 1000)

const stop = () => {
  clearInterval(timer)
  server.close(() => void db.end().then(() => process.exit(0)))
  setTimeout(() => process.exit(0), 25_000).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
