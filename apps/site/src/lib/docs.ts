// The docs pages are the repository's own Markdown, rendered at build time, so the site's docs
// always match the release they were built from.
import { Marked, type Tokens } from 'marked'
import { GITHUB_AT_VERSION } from './site.ts'

const raw = import.meta.glob(
  ['../../../../docs/**/*.md', '../../../../CHANGELOG.md', '../../../../packages/kit/CHANGELOG.md'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

/** Repository path (e.g. `docs/security.md`) → Markdown source. */
const sources = new Map(
  Object.entries(raw).map(([key, text]) => [key.replace(/^(\.\.\/)+/, ''), text]),
)

/** Site page slug → repository file. */
const pageFiles = new Map<string, string>([
  ['run', 'docs/run.md'],
  ['build', 'docs/build.md'],
  ['getting-started', 'docs/getting-started.md'],
  ['dashboard', 'docs/dashboard.md'],
  ['guides/local-stack', 'docs/guides/local-stack.md'],
  ['security', 'docs/security.md'],
  ['contracts', 'docs/contracts.md'],
  ['guides/backend-kit', 'docs/guides/backend-kit.md'],
  ['guides/kit-nuxt', 'docs/guides/kit-nuxt.md'],
  ['guides/kit-tanstack-start', 'docs/guides/kit-tanstack-start.md'],
  ['guides/deploy-from-ci', 'docs/guides/deploy-from-ci.md'],
  ['guides/backups', 'docs/guides/backups.md'],
  ['guides/breach', 'docs/guides/breach.md'],
  ['guides/move-into-the-pool', 'docs/guides/move-into-the-pool.md'],
  ['changelog', 'CHANGELOG.md'],
  ['kit-changelog', 'packages/kit/CHANGELOG.md'],
  ['decisions', 'docs/decisions/README.md'],
])
for (const path of sources.keys()) {
  const adr = /^docs\/decisions\/(\d{4}-[a-z0-9-]+)\.md$/.exec(path)
  if (adr) pageFiles.set(`decisions/${adr[1]}`, path)
}
const slugByFile = new Map([...pageFiles].map(([slug, file]) => [file, slug]))

export interface DocPage {
  slug: string
  title: string
  /** ADR front matter (status, date…), when the file has it. */
  meta: Record<string, string>
  html: string
  /** The file on GitHub, at this version. */
  source: string
}

/**
 * The sidebar: one group per reader, each with its landing page, then what both share. Pages
 * keep their URLs whichever group they are in.
 */
export const NAV = [
  {
    title: 'Run Spotcraft',
    landing: 'run',
    pages: [
      { slug: 'getting-started', label: 'Getting started' },
      { slug: 'dashboard', label: 'Using the dashboard' },
      { slug: 'guides/backups', label: 'Backups and restoring' },
      { slug: 'guides/breach', label: 'When personal data leaks' },
      { slug: 'guides/move-into-the-pool', label: 'Moving an app into the pool' },
    ],
  },
  {
    title: 'Build apps',
    landing: 'build',
    pages: [
      { slug: 'contracts', label: 'The app contract' },
      { slug: 'guides/local-stack', label: 'Develop locally' },
      { slug: 'guides/backend-kit', label: 'Guest accounts (kit)' },
      { slug: 'guides/kit-nuxt', label: 'Kit in Nuxt' },
      { slug: 'guides/kit-tanstack-start', label: 'Kit in TanStack Start' },
      { slug: 'guides/deploy-from-ci', label: 'Deploy from CI' },
    ],
  },
  {
    title: 'Reference',
    landing: null,
    pages: [
      { slug: 'security', label: 'Security model' },
      { slug: 'decisions', label: 'Decisions' },
      { slug: 'changelog', label: 'Changelog' },
      { slug: 'kit-changelog', label: 'Kit changelog' },
    ],
  },
]

export const allSlugs = () => [...pageFiles.keys()]

function splitFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (pair) meta[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1')
  }
  return { meta, body: text.slice(match[0].length) }
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

/** Resolves `href` relative to the repository file `from`; null for external links. */
function resolveRepoPath(from: string, href: string): { path: string; hash: string } | null {
  if (/^[a-z]+:|^\/\/|^#/i.test(href)) return null
  const [target, hash = ''] = href.split('#')
  const parts = from.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return { path: parts.join('/'), hash: hash ? `#${hash}` : '' }
}

export function renderDoc(slug: string): DocPage | undefined {
  const file = pageFiles.get(slug)
  const text = file ? sources.get(file) : undefined
  if (!file || text === undefined) return undefined
  const { meta, body } = splitFrontMatter(text)
  let title = meta.title ?? ''
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens)
        if (depth === 1) {
          // The page header shows the title; the document's own H1 is dropped.
          title ||= inner.replace(/<[^>]+>/g, '')
          return ''
        }
        const id = slugify(inner)
        return `<h${depth} id="${id}"><a href="#${id}">${inner}</a></h${depth}>\n`
      },
      link({ href, title: linkTitle, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens)
        const resolved = resolveRepoPath(file, href)
        let url = href
        let external = false
        if (resolved) {
          const page = slugByFile.get(resolved.path)
          url = page
            ? `/docs/${page}${resolved.hash}`
            : `${GITHUB_AT_VERSION}/${resolved.path}${resolved.hash}`
          external = !page
        } else {
          external = /^https?:/.test(href)
        }
        const attrs = external ? ' rel="noopener noreferrer"' : ''
        const titleAttr = linkTitle ? ` title="${linkTitle}"` : ''
        return `<a href="${url}"${titleAttr}${attrs}>${inner}</a>`
      },
    },
  })
  const html = marked.parse(body, { async: false }) as string
  return { slug, title: title || slug, meta, html, source: `${GITHUB_AT_VERSION}/${file}` }
}
