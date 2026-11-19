#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { appName, localEnv, writeMissing } from './project.ts'
import { appLayout, appRoleName, provision, purge } from './provision.ts'
import {
  adminUrl,
  appPassword,
  databaseUrl,
  down,
  isRunning,
  PORT,
  StackError,
  up,
} from './stack.ts'

const HELP = `Usage: spotcraft dev <command> [--name <app>]

Runs the same Postgres and app schema setup as a Spotcraft server, on this machine.

Commands:
  start         start the local Postgres and set up this app's schema
  stop          stop the local Postgres (the data stays)
  status        show whether it runs and this app's schema
  env [--write] print DATABASE_URL, DATABASE_SCHEMA and AUTH_SECRET; --write adds missing ones to .env
  reset [--yes] delete this app's schema and start it empty
  migrate       bring this app's role settings up to date after upgrading

The app name comes from --name or package.json. Needs Docker.
`

const print = (line = '') => process.stdout.write(`${line}\n`)

async function ensureRunning() {
  if (!(await isRunning()))
    throw new StackError('The local Postgres is not running; run `spotcraft dev start`')
}

/** The app's env: its own database if it still has one (ADR 0034), else its schema. */
async function appEnv(cwd: string, name: string, ownDatabase: boolean) {
  return ownDatabase
    ? localEnv(cwd, databaseUrl(name, appRoleName(name)))
    : localEnv(cwd, databaseUrl(name), appRoleName(name))
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      write: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const [group, command] = positionals
  if (values.help || group !== 'dev' || !command) {
    print(HELP)
    return values.help ? 0 : 1
  }
  const cwd = process.cwd()

  switch (command) {
    case 'start': {
      const name = await appName(cwd, values.name)
      await up()
      const { database } = await provision(adminUrl(), { name, password: appPassword(name) })
      const ownDatabase = database === appRoleName(name)
      print(
        ownDatabase
          ? `Local Postgres on 127.0.0.1:${PORT}; ${appRoleName(name)} still has its own database.`
          : `Local Postgres on 127.0.0.1:${PORT}; schema ${appRoleName(name)} in ${database} is ready.`,
      )
      print()
      for (const [key, value] of await appEnv(cwd, name, ownDatabase)) print(`${key}=${value}`)
      print()
      print('Add these to .env with: spotcraft dev env --write')
      return 0
    }
    case 'stop':
      await down()
      print('Local Postgres stopped; the data stays.')
      return 0
    case 'status': {
      const name = await appName(cwd, values.name)
      if (!(await isRunning())) {
        print('Local Postgres: stopped (spotcraft dev start)')
        return 0
      }
      // Running but never set up (e.g. started by hand) reads as "not set up yet".
      const layout = await appLayout(adminUrl(), name).catch(() => 'none' as const)
      print(`Local Postgres: running on 127.0.0.1:${PORT}`)
      const state = {
        schema: 'ready',
        database: 'ready, in its own database (spotcraft dev reset moves it to a schema)',
        none: 'not set up yet (spotcraft dev start)',
      }[layout]
      print(`${appRoleName(name)}: ${state}`)
      return 0
    }
    case 'env': {
      const name = await appName(cwd, values.name)
      const layout = (await isRunning()) ? await appLayout(adminUrl(), name) : 'none'
      const env = await appEnv(cwd, name, layout === 'database')
      if (!values.write) {
        for (const [key, value] of env) print(`${key}=${value}`)
        return 0
      }
      const { added, kept } = await writeMissing(cwd, env)
      if (added.length) print(`Added to .env: ${added.join(', ')}`)
      if (kept.length) print(`Already in .env, left as they are: ${kept.join(', ')}`)
      return 0
    }
    case 'reset': {
      const name = await appName(cwd, values.name)
      await ensureRunning()
      const db = appRoleName(name)
      if (
        !values.yes &&
        !(await confirm(`Delete everything in the local ${db} and start it empty?`))
      ) {
        print('Nothing changed.')
        return 1
      }
      await purge(adminUrl(), name)
      await provision(adminUrl(), { name, password: appPassword(name) })
      print(`${db} is empty again.`)
      return 0
    }
    case 'migrate': {
      const name = await appName(cwd, values.name)
      await ensureRunning()
      await provision(adminUrl(), { name, password: appPassword(name) })
      print(`${appRoleName(name)}: up to date.`)
      return 0
    }
    default:
      print(HELP)
      return 1
  }
}

// Run when executed (not when a test imports it).
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`spotcraft: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    },
  )
}
