import { appRoleName, INSTANCE } from '@kodentuzo/spotcraft/provision'
import { AccessApps } from './access.ts'
import { Umami } from './analytics.ts'
import { buildApp } from './app.ts'
import { ANALYTICS_BACKUP, Apps, POOL_BACKUP } from './apps.ts'
import { dockerDump, dockerPruneAnalytics, dockerRestore, untilNext } from './backups.ts'
import { CloudflareApi } from './cloudflare.ts'
import { loadConfig } from './config.ts'
import { postgresDatabases } from './databases.ts'
import { Domains } from './domains.ts'
import { Legal } from './legal.ts'
import { execRunner } from './runner.ts'
import { S3 } from './s3.ts'
import { Store } from './store.ts'

const config = loadConfig()
/** A dump of the platform's own data: the user pool's `auth` schema, or a whole database. */
const dumpOf = (container: string, database: string, schema?: string) => () =>
  dockerDump(container, async () => ({ database, schema }))(schema ?? database)
const databases = config.postgresUrl ? postgresDatabases(config.postgresUrl) : undefined
const cf = config.cloudflare
const api = cf ? new CloudflareApi(cf.apiToken, cf.accountId) : undefined
const cloudflare =
  cf && api
    ? {
        domains: new Domains({ api, appsZoneId: cf.appsZoneId, tunnelId: cf.tunnelId }),
        access: cf.accessPolicyId ? new AccessApps(api, cf.accessPolicyId) : undefined,
      }
    : undefined
const apps = new Apps(
  new Store(config.dataDir),
  execRunner,
  config.caddyContainer,
  databases,
  {
    appsDomain: config.appsDomain,
    dashboardDomain: config.dashboardDomain,
    authIssuer: config.authIssuer,
    edge: config.edge,
    analyticsMode: config.analyticsMode,
  },
  cloudflare,
  config.backup && {
    target: new S3(config.backup),
    dump: dockerDump(config.backup.postgresContainer, async (app) =>
      databases ? databases.dumpTarget(app) : { database: appRoleName(app) },
    ),
    // Only into a schema of the instance database (ADR 0043), so only with Postgres.
    ...(databases && {
      restore: dockerRestore(config.backup.postgresContainer, INSTANCE.database, appRoleName),
    }),
    platform: [
      // The user pool's schema in the apps database (ADR 0035).
      {
        folder: POOL_BACKUP,
        file: 'auth.dump',
        dump: dumpOf(config.backup.postgresContainer, INSTANCE.database, 'auth'),
      },
      // Analytics' own database (ADR 0038).
      {
        folder: ANALYTICS_BACKUP,
        file: 'umami.dump',
        dump: dumpOf(config.backup.postgresContainer, 'umami'),
      },
    ],
  },
)
if (config.analytics) apps.analytics = new Umami(config.analytics.url, config.analytics.password)
// The legal facts (ADR 0043), from the owner's details and what this instance is set up with.
apps.legal = new Legal(config.dataDir, {
  edge: config.edge,
  backupEndpoint: config.backup?.endpoint,
  analytics: { mode: config.analyticsMode, days: config.analytics?.days ?? 395 },
  ...config.retention,
})
const app = buildApp({
  token: config.token,
  apps,
  allowedIps: config.allowedIps,
  logger: { level: config.logLevel },
})

for (const notice of config.notices) app.log.warn(notice)

// Finish in-flight requests (a deploy may be running) before exiting on stop.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

await app.listen({ host: config.host, port: config.port })

// Recover from a deploy the previous agent didn't finish, lock down older app files, and
// rewrite every app's site (sites follow EDGE and APPS_DOMAIN, which may have changed). Caddy
// may still be starting (both start in the same deploy), so a failed reload is retried.
for (let attempt = 1; attempt <= 24; attempt++) {
  try {
    const changed = await apps.recover()
    if (changed.length > 0)
      app.log.info({ changed }, 'app sites rewritten for the current settings')
    break
  } catch (error) {
    if (attempt === 24) {
      app.log.error({ err: error }, 'gave up rewriting app sites')
      break
    }
    app.log.warn({ attempt }, 'could not reload Caddy with rewritten sites; retrying')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

// Apps without an Umami website (made before analytics, or while Umami was down) get one, and
// their sites start counting. Umami may still be starting; this waits for it in the background.
apps.backfillAnalytics().then(
  (started) => started.length > 0 && app.log.info({ started }, 'analytics on for these apps'),
  (error) => app.log.warn({ err: error }, 'could not turn analytics on for every app'),
)

// After an upgrade, bring every app database up to date. Postgres may still be starting
// (both start in the same deploy), so failures are retried for a few minutes.
if (databases) {
  for (let attempt = 1; attempt <= 36; attempt++) {
    const { upgraded, failed } = await apps.upgradeDatabases()
    if (failed.length === 0) {
      if (upgraded.length > 0) app.log.info({ upgraded }, 'app databases up to date')
      break
    }
    if (attempt === 36) {
      app.log.error({ failed }, 'gave up bringing app databases up to date')
      break
    }
    app.log.warn({ failed, attempt }, 'app databases not up to date yet; retrying')
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

// Every night at 04:00 UTC, after the backups, delete Umami's events older than ANALYTICS_DAYS
// (ADR 0043): Umami itself keeps them forever.
const PRUNE_HOUR_UTC = 4
if (config.analytics) {
  const { days, postgresContainer } = config.analytics
  const prune = dockerPruneAnalytics(postgresContainer)
  const nightly = async () => {
    try {
      const deleted = (await prune(days)).trim()
      if (deleted) app.log.info({ deleted: deleted.split('\n') }, 'old analytics deleted')
    } catch (error) {
      app.log.error({ err: error }, 'could not delete old analytics')
    }
    setTimeout(nightly, untilNext(PRUNE_HOUR_UTC)).unref()
  }
  setTimeout(nightly, untilNext(PRUNE_HOUR_UTC)).unref()
  app.log.info(
    { days, mode: config.analyticsMode },
    'analytics older than ANALYTICS_DAYS deleted nightly',
  )
}

// Every night at 03:00 UTC, back up every app (ADR 0030). Each app's result is kept in its
// backup.json, which the dashboard shows; failures are also logged.
const BACKUP_HOUR_UTC = 3
if (config.backup) {
  const nightly = async () => {
    try {
      const results = await apps.backupAll()
      const failed = Object.entries(results).filter(([, status]) => !status.ok)
      if (failed.length > 0)
        app.log.error({ failed: failed.map(([name]) => name) }, 'backups failed')
      else app.log.info({ apps: Object.keys(results) }, 'backups done')
    } catch (error) {
      app.log.error({ err: error }, 'backups could not run')
    }
    setTimeout(nightly, untilNext(BACKUP_HOUR_UTC)).unref()
  }
  setTimeout(nightly, untilNext(BACKUP_HOUR_UTC)).unref()
  app.log.info({ bucket: config.backup.bucket }, 'nightly backups at 03:00 UTC')
}
