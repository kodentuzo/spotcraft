#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import {
  appName,
  findRoot,
  localEnv,
  parseEnv,
  readSpotcraftJson,
  repoSlug,
  writeMissing,
} from './project.ts'
import { appLayout, appRoleName, provision, purge } from './provision.ts'
import {
  adminUrl,
  appPassword,
  databaseUrl,
  down,
  isRunning,
  listStacks,
  loadStack,
  mailUrl,
  poolImage,
  poolUrl,
  type Stack,
  StackError,
  up,
} from './stack.ts'

const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

const HELP = `Usage: spotcraft dev [command] [--name <app>]

Runs a local stack that matches a Spotcraft server, one per repository (ADR 0037): Postgres,
the user pool and Mailpit. Needs Docker.

Commands:
  (none)          start the stack if needed, set up this app's schema, add missing settings
                  to .env, and run "migrate" from spotcraft.json
  env [--write]   print this app's settings; --write adds missing ones to .env
  db reset [--yes]
                  delete everything in this app's schema and start it empty, then migrate
  migrate         run "migrate" from spotcraft.json with this app's settings
  status          whether the stack runs, its addresses, and this app's schema
  stop            stop the stack (the data stays)
  ls              every repository's stack on this machine

The app name comes from --name, spotcraft.json or package.json.
`

const print = (line = '') => process.stdout.write(`${line}\n`)

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

/** This app's settings: its schema (or its own old database), the pool, mail. */
async function appEnv(cwd: string, stack: Stack, name: string) {
  const layout = (await isRunning(stack)) ? await appLayout(adminUrl(stack), name) : 'none'
  return layout === 'database'
    ? localEnv(cwd, stack, { name, databaseUrl: databaseUrl(stack, name, appRoleName(name)) })
    : localEnv(cwd, stack, {
        name,
        databaseUrl: databaseUrl(stack, name),
        schema: appRoleName(name),
      })
}

/**
 * Runs `migrate` from spotcraft.json in the app's folder, through the shell (it is the
 * repository's own command), with the app's settings: those in .env win over the stack's.
 */
async function migrate(cwd: string, stack: Stack, name: string): Promise<number> {
  const { migrate: command } = await readSpotcraftJson(cwd)
  if (!command) {
    print('No "migrate" in spotcraft.json; nothing to run.')
    return 0
  }
  const env = Object.fromEntries(await appEnv(cwd, stack, name))
  const own = parseEnv(await readFile(join(cwd, '.env'), 'utf8').catch(() => ''))
  print(`$ ${command}`)
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ...env, ...Object.fromEntries(own) },
    })
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(127))
  })
}

function addresses(stack: Stack) {
  print(`Postgres  127.0.0.1:${stack.ports.postgres}`)
  print(`Users     ${poolUrl(stack)}`)
  print(`Mail      ${mailUrl(stack)}`)
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
  const [group, ...rest] = positionals
  const command = rest.join(' ')
  if (values.help || group !== 'dev') {
    print(HELP)
    return values.help ? 0 : 1
  }
  const cwd = process.cwd()
  const root = await findRoot(cwd)
  const stack = await loadStack(root, repoSlug(root))
  const image = poolImage(VERSION)

  switch (command) {
    case '':
    case 'start': {
      const name = await appName(cwd, values.name)
      await up(stack, image)
      const { database } = await provision(adminUrl(stack), { name, password: appPassword(name) })
      const env = await appEnv(cwd, stack, name)
      const { added, kept } = await writeMissing(cwd, env)
      print(`${stack.project} is up; ${appRoleName(name)} is ready in ${database}.`)
      addresses(stack)
      if (added.length) print(`Added to .env: ${added.join(', ')}`)
      if (kept.length) print(`Already in .env, left as they are: ${kept.join(', ')}`)
      return migrate(cwd, stack, name)
    }
    case 'stop':
      await down(stack, image)
      print(`${stack.project} stopped; the data stays.`)
      return 0
    case 'ls': {
      const stacks = await listStacks()
      if (stacks.length === 0) print('No local stacks.')
      for (const { name, status } of stacks) print(`${name.padEnd(30)} ${status}`)
      return 0
    }
    case 'status': {
      const name = await appName(cwd, values.name)
      if (!(await isRunning(stack))) {
        print(`${stack.project}: stopped (spotcraft dev)`)
        return 0
      }
      const layout = await appLayout(adminUrl(stack), name).catch(() => 'none' as const)
      print(`${stack.project}: running`)
      addresses(stack)
      const state = {
        schema: 'ready',
        database: 'ready, in its own database (spotcraft dev db reset moves it to a schema)',
        none: 'not set up yet (spotcraft dev)',
      }[layout]
      print(`${appRoleName(name)}: ${state}`)
      return 0
    }
    case 'env': {
      const name = await appName(cwd, values.name)
      const env = await appEnv(cwd, stack, name)
      if (!values.write) {
        for (const [key, value] of env) print(`${key}=${value}`)
        return 0
      }
      const { added, kept } = await writeMissing(cwd, env)
      if (added.length) print(`Added to .env: ${added.join(', ')}`)
      if (kept.length) print(`Already in .env, left as they are: ${kept.join(', ')}`)
      return 0
    }
    case 'db reset':
    case 'reset': {
      const name = await appName(cwd, values.name)
      if (!(await isRunning(stack)))
        throw new StackError('The stack is not running; run `spotcraft dev`')
      const role = appRoleName(name)
      if (
        !values.yes &&
        !(await confirm(`Delete everything in the local ${role} and start it empty?`))
      ) {
        print('Nothing changed.')
        return 1
      }
      await purge(adminUrl(stack), name)
      await provision(adminUrl(stack), { name, password: appPassword(name) })
      print(`${role} is empty again.`)
      return migrate(cwd, stack, name)
    }
    case 'migrate': {
      const name = await appName(cwd, values.name)
      if (!(await isRunning(stack)))
        throw new StackError('The stack is not running; run `spotcraft dev`')
      await provision(adminUrl(stack), { name, password: appPassword(name) })
      return migrate(cwd, stack, name)
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
