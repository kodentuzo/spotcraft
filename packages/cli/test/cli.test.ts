import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  appName,
  findRoot,
  localEnv,
  parseEnv,
  readSpotcraftJson,
  repoSlug,
  writeMissing,
} from '../src/project.ts'
import {
  ADMIN_SQL,
  composeFile,
  databaseUrl,
  LOCAL_ISSUER,
  listStacks,
  loadStack,
  PG_HBA,
  POSTGRES_IMAGE,
  poolImage,
  projectName,
  type RunResult,
  type Stack,
  StackError,
  UMAMI_IMAGE,
  up,
} from '../src/stack.ts'

const repo = new URL('../../../', import.meta.url)
const repoFile = (path: string) => readFile(new URL(path, repo), 'utf8')

/** A stack with fixed ports, as `loadStack` would save it. */
const stack: Stack = {
  project: 'spotcraft-dev-lifts',
  stateDir: '/tmp/lifts/.spotcraft',
  ports: { postgres: 50001, auth: 50002, smtp: 50003, mail: 50004, analytics: 50005 },
  authSecret: 'a'.repeat(64),
}

describe('same as the server', () => {
  it('uses the Postgres image of the server and of CI', async () => {
    const compose = await repoFile('infra/server/compose.yaml')
    const ci = await repoFile('.github/workflows/ci.yml')
    const images = (text: string) => [...text.matchAll(/image: (postgres:\S+)/g)].map((m) => m[1])
    assert.deepEqual(images(compose), [POSTGRES_IMAGE])
    // CI has a database for each job that runs the database tests: every one must match.
    assert.ok(images(ci).length > 0)
    assert.deepEqual(new Set(images(ci)), new Set([POSTGRES_IMAGE]))
  })

  it('uses the Umami image of the server, and the same paths', async () => {
    const server = await repoFile('infra/server/compose.yaml')
    const local = JSON.parse(composeFile(stack, 'image:tag')).services.umami
    assert.equal(local.image, UMAMI_IMAGE)
    assert.ok(server.includes(`image: ${UMAMI_IMAGE}\n`), 'the server pins the same image')
    for (const name of ['TRACKER_SCRIPT_NAME', 'COLLECT_API_ENDPOINT', 'DISABLE_TELEMETRY'])
      assert.ok(server.includes(`${name}: ${local.environment[name]}\n`), name)
  })

  it('uses the login rules of the server', async () => {
    const rules = (text: string) =>
      text
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => line.trim().split(/\s+/).join(' '))
    assert.deepEqual(rules(PG_HBA), rules(await repoFile('infra/server/pg_hba.conf')))
  })

  it("sets up the roles with the deploy script's SQL", async () => {
    const script = await repoFile('infra/remote-deploy.sh')
    const sql = /cat <<'SQL'\n([\s\S]*?)\nSQL\n/.exec(script)?.[1]
    assert.equal(`${sql}\n`, ADMIN_SQL)
  })

  it('runs the user pool like the server, over plain HTTP, trusting local dev servers', () => {
    const compose = JSON.parse(composeFile(stack, 'vindotski/spotcraft:0.6.0'))
    const auth = compose.services.auth
    assert.equal(auth.image, 'vindotski/spotcraft:0.6.0')
    assert.equal(auth.working_dir, '/app/auth')
    assert.deepEqual(auth.command, ['src/index.ts'])
    assert.equal(auth.environment.AUTH_PROTOCOL, 'http')
    assert.equal(auth.environment.AUTH_LOCAL_ORIGINS, '1')
    assert.equal(auth.environment.AUTH_ISSUER, LOCAL_ISSUER)
    assert.equal(auth.environment.AUTH_SECRET, stack.authSecret)
    assert.match(auth.environment.AUTH_DATABASE_URL, /@postgres:5432\/apps$/)
  })

  it('publishes everything on localhost only, on the stack’s own ports', () => {
    const compose = JSON.parse(composeFile(stack, 'image:tag'))
    assert.equal(compose.name, 'spotcraft-dev-lifts')
    assert.deepEqual(compose.services.postgres.ports, ['127.0.0.1:50001:5432'])
    assert.deepEqual(compose.services.auth.ports, ['127.0.0.1:50002:3000'])
    assert.deepEqual(compose.services.mailpit.ports, [
      '127.0.0.1:50003:1025',
      '127.0.0.1:50004:8025',
    ])
    assert.deepEqual(compose.services.umami.ports, ['127.0.0.1:50005:3000'])
    assert.equal(compose.configs.pg_hba.content, PG_HBA)
  })

  it("runs the pool from this CLI's version, unless told another image", () => {
    assert.equal(poolImage('0.6.0', {}), 'vindotski/spotcraft:0.6.0')
    assert.equal(poolImage('0.6.0', { SPOTCRAFT_DEV_IMAGE: 'local:dev' }), 'local:dev')
  })
})

describe('a repository and its stack', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-cli-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('finds the root from a deployable folder, and names the stack after it', async () => {
    const root = join(dir, 'Libre Lifts')
    await mkdir(join(root, 'apps', 'api'), { recursive: true })
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    assert.equal(await findRoot(join(root, 'apps', 'api')), root)
    assert.equal(repoSlug(root), 'libre-lifts')
    const lone = join(dir, 'lone')
    await mkdir(lone)
    assert.equal(await findRoot(lone), lone, 'no root: the folder itself')
  })

  it('picks distinct ports once, keeps them, and ignores its own folder in git', async () => {
    let next = 49000
    const ports = async () => (next++ % 2 === 0 ? 49000 : next)
    const first = await loadStack(dir, 'lifts', ports)
    const all = Object.values(first.ports)
    assert.equal(new Set(all).size, 5, 'five different ports')
    assert.equal(first.project, projectName(dir, 'lifts'))
    assert.match(first.project, /^spotcraft-dev-lifts-[0-9a-f]{6}$/)
    assert.match(first.authSecret, /^[0-9a-f]{64}$/)
    assert.equal(await readFile(join(dir, '.spotcraft/.gitignore'), 'utf8'), '*\n')
    const again = await loadStack(dir, 'lifts', async () => 1)
    assert.deepEqual(again, first, 'read back, not picked again')
  })

  it('names stacks of same-named folders apart, within Compose’s rules', () => {
    const one = projectName('/work/sokobanko/.claude/worktrees/user-pool', 'user-pool')
    const two = projectName('/work/vinskiano/.claude/worktrees/user-pool', 'user-pool')
    assert.notEqual(one, two)
    for (const name of [one, two]) assert.match(name, /^spotcraft-dev-user-pool-[0-9a-f]{6}$/)
    assert.equal(projectName('/work/a', 'a'), projectName('/work/a', 'a'), 'the same every time')
  })

  it('keeps the name a stack was given, even if the folder is renamed', async () => {
    let next = 49000
    const first = await loadStack(dir, 'lifts', async () => next++)
    const saved = JSON.parse(await readFile(join(dir, '.spotcraft/dev.json'), 'utf8'))
    assert.equal(saved.project, first.project)
    const renamed = await loadStack(dir, 'other-name', async () => 1)
    assert.equal(renamed.project, first.project)
  })

  it('keeps the name of a stack made by 0.6.0, and writes it down', async () => {
    const ports = { postgres: 50001, auth: 50002, smtp: 50003, mail: 50004 }
    await mkdir(join(dir, '.spotcraft'))
    const file = join(dir, '.spotcraft/dev.json')
    await writeFile(file, JSON.stringify({ ports, authSecret: 'b'.repeat(64) }))
    const old = await loadStack(dir, 'lifts', async () => 1)
    assert.equal(old.project, 'spotcraft-dev-lifts')
    assert.deepEqual(old.ports, { ...ports, analytics: 1 })
    assert.equal(JSON.parse(await readFile(file, 'utf8')).project, 'spotcraft-dev-lifts')
  })

  it('gives a stack from before analytics a port for it, without moving the others', async () => {
    const ports = { postgres: 50001, auth: 50002, smtp: 50003, mail: 50004 }
    await mkdir(join(dir, '.spotcraft'))
    const file = join(dir, '.spotcraft/dev.json')
    const project = 'spotcraft-dev-lifts-0a1b2c'
    await writeFile(file, JSON.stringify({ project, ports, authSecret: 'b'.repeat(64) }))
    const taken = [50002, 50001, 50006]
    const stack = await loadStack(dir, 'lifts', async () => taken.shift() ?? 0)
    assert.deepEqual(stack.ports, { ...ports, analytics: 50006 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).ports, stack.ports)
    assert.equal(stack.project, project)
  })

  it('lists only the local stacks', async () => {
    const runner = async (): Promise<RunResult> => ({
      code: 0,
      stdout: JSON.stringify([
        { Name: 'spotcraft-dev-lifts', Status: 'running(3)' },
        { Name: 'spotcraft-apps', Status: 'running(9)' },
      ]),
      stderr: '',
    })
    assert.deepEqual(await listStacks(runner), [{ name: 'lifts', status: 'running(3)' }])
  })
})

describe('app name and spotcraft.json', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spotcraft-cli-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const withPackage = (name: unknown) =>
    writeFile(join(dir, 'package.json'), JSON.stringify({ name }))

  it('comes from package.json, made into an app name', async () => {
    for (const [pkg, expected] of [
      ['tagtape', 'tagtape'],
      ['@acme/Blog_API', 'blog-api'],
      ['my.app', 'my-app'],
      ['2048-game', 'game'],
    ]) {
      await withPackage(pkg)
      assert.equal(await appName(dir), expected, pkg)
    }
  })

  it('prefers --name, then spotcraft.json, and says what to do when there is none', async () => {
    await withPackage('from-package')
    await writeFile(
      join(dir, 'spotcraft.json'),
      '{ "name": "lifts-api", "migrate": "pnpm db:migrate" }',
    )
    assert.equal(await appName(dir), 'lifts-api')
    assert.equal(await appName(dir, 'from-flag'), 'from-flag')
    assert.deepEqual(await readSpotcraftJson(dir), {
      name: 'lifts-api',
      migrate: 'pnpm db:migrate',
    })
    await assert.rejects(appName(dir, 'Bad_Name'), /not a Spotcraft app name/)
    await rm(join(dir, 'spotcraft.json'))
    await rm(join(dir, 'package.json'))
    await assert.rejects(appName(dir), /pass the app name with --name/)
  })

  it('refuses a spotcraft.json it can’t read', async () => {
    await writeFile(join(dir, 'spotcraft.json'), '{ nope')
    await assert.rejects(readSpotcraftJson(dir), /not valid JSON/)
    await writeFile(join(dir, 'spotcraft.json'), '{ "migrate": ["pnpm", "migrate"] }')
    await assert.rejects(readSpotcraftJson(dir), /"migrate" must be a command/)
  })

  it("gives each app its role's URL on the stack's own port", () => {
    assert.equal(
      databaseUrl(stack, 'blog-api'),
      'postgres://app_blog_api:local-blog-api-password@127.0.0.1:50001/apps',
    )
    // An app that still has its own database (from before ADR 0034).
    assert.equal(
      databaseUrl(stack, 'blog-api', 'app_blog_api'),
      'postgres://app_blog_api:local-blog-api-password@127.0.0.1:50001/app_blog_api',
    )
  })

  describe('.env', () => {
    const app = () => ({
      name: 'demo',
      databaseUrl: databaseUrl(stack, 'demo'),
      schema: 'app_demo',
    })

    it("has the server's names, pointing at the local stack", async () => {
      const env = await localEnv(dir, stack, app())
      assert.equal(env.get('DATABASE_SCHEMA'), 'app_demo')
      assert.equal(env.get('AUTH_URL'), 'http://localhost:50002/_spotcraft/auth')
      assert.equal(env.get('AUTH_JWKS_URL'), 'http://localhost:50002/_spotcraft/auth/jwks')
      assert.equal(env.get('AUTH_ISSUER'), LOCAL_ISSUER)
      assert.equal(env.get('SMTP_URL'), 'smtp://localhost:50003')
      const facts = JSON.parse(env.get('LEGAL_FACTS')?.slice(1, -1) ?? '')
      assert.match(facts.controller.email, /\.invalid$/)
      assert.equal(env.get('MAIL_FROM'), 'demo@localhost')
      assert.match(env.get('APP_SECRET') ?? '', /^[A-Za-z0-9_-]{43}$/)
    })

    it('adds only what is missing and keeps every existing line', async () => {
      const original = '# mine\nAPP_SECRET=keep-me\nDATABASE_URL=postgres://other/db'
      await writeFile(join(dir, '.env'), original)
      const env = await localEnv(dir, stack, app())
      assert.equal(env.get('APP_SECRET'), 'keep-me')
      const { added, kept } = await writeMissing(dir, env)
      assert.deepEqual(kept, ['DATABASE_URL', 'APP_SECRET'])
      assert.ok(!added.includes('APP_SECRET'))
      assert.ok((await readFile(join(dir, '.env'), 'utf8')).startsWith(original))
    })

    it('creates .env, and a second run adds nothing', async () => {
      const env = await localEnv(dir, stack, app())
      assert.ok((await writeMissing(dir, env)).added.includes('DATABASE_URL'))
      const written = parseEnv(await readFile(join(dir, '.env'), 'utf8'))
      assert.equal(written.get('APP_SECRET'), env.get('APP_SECRET'))
      const again = await localEnv(dir, stack, app())
      assert.deepEqual((await writeMissing(dir, again)).added, [])
    })

    it("gives an app that still has its own database only that, and the kit's secret", async () => {
      const env = await localEnv(dir, stack, {
        name: 'demo',
        databaseUrl: databaseUrl(stack, 'demo', 'app_demo'),
      })
      assert.deepEqual([...env.keys()], ['DATABASE_URL', 'AUTH_SECRET'])
    })
  })
})

describe('starting the stack', () => {
  /** Records calls; `failing` names an argument whose call fails. */
  function fakeRunner(failing?: string) {
    const calls: { args: string[]; input?: string }[] = []
    const runner = async (_file: string, args: string[], input?: string): Promise<RunResult> => {
      calls.push({ args, input })
      const fails = failing !== undefined && args.includes(failing)
      return { code: fails ? 1 : 0, stdout: '', stderr: fails ? 'boom' : '' }
    }
    return { runner, calls }
  }

  it('starts Postgres, sets up the roles, then the user pool and Mailpit', async () => {
    const { runner, calls } = fakeRunner()
    await up(stack, 'image:tag', runner)
    assert.deepEqual(
      calls.map(({ args }) => args.slice(0, 2)),
      [
        ['version', '--format'],
        ['compose', '-p'],
        ['exec', '-i'],
        ['compose', '-p'],
      ],
    )
    assert.equal(calls[1].args.at(-1), 'postgres', 'Postgres alone first')
    assert.equal(calls[1].input, composeFile(stack, 'image:tag'), 'the compose file on stdin')
    assert.deepEqual(calls[2].args.slice(0, 5), [
      'exec',
      '-i',
      '-u',
      'postgres',
      'spotcraft-dev-lifts-postgres-1',
    ])
    assert.match(calls[2].input ?? '', /^\\set pw \S+\n\\set auth_pw \S+\n\\set umami_pw \S+\n/)
    assert.ok(calls[2].input?.endsWith(ADMIN_SQL))
    assert.ok(calls[3].args.includes('--wait'))
    assert.notEqual(calls[3].args.at(-1), 'postgres', 'then everything')
  })

  it('says plainly when Docker is not running, and which image the pool needs', async () => {
    await assert.rejects(up(stack, 'image:tag', fakeRunner('version').runner), (error: Error) => {
      assert.ok(error instanceof StackError)
      assert.match(error.message, /Docker is not running/)
      return true
    })
    const pool = fakeRunner()
    const failingSecondUp: typeof pool.runner = async (file, args, input) =>
      args.includes('compose') && !args.includes('postgres') && args.includes('up')
        ? { code: 1, stdout: '', stderr: 'manifest unknown' }
        : pool.runner(file, args, input)
    await assert.rejects(
      up(stack, 'vindotski/spotcraft:9.9.9', failingSecondUp),
      /vindotski\/spotcraft:9\.9\.9/,
    )
  })
})
