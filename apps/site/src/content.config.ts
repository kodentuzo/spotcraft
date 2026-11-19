import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

/** A screenshot in `public/showcase/`, 1280x800; `dark` is the same view in dark mode. */
const screenshot = z.object({
  light: z.string().startsWith('/showcase/'),
  dark: z.string().startsWith('/showcase/').optional(),
  alt: z.string(),
})

/** A figure from the server's dashboard. `null` while it's still to be read off. */
const figure = z.string().nullable()

// One Markdown file per app in `src/content/showcase/`: the front matter is the facts, the body
// is the story. The file name is the page's slug.
const showcase = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/showcase' }),
  schema: z.object({
    name: z.string(),
    url: z.url(),
    source: z.url(),
    oneLiner: z.string(),
    /** "What it is": two or three sentences. */
    about: z.string(),
    /** The Spotcraft features the app uses; the first four are the card's tags. */
    features: z.array(z.object({ name: z.string(), text: z.string() })).min(3),
    numbers: z.object({
      /** The day the figures were read off the dashboard. */
      date: z.coerce.date().nullable(),
      memory: figure,
      memoryLimit: figure,
      uptime: figure,
      deployTime: figure,
      imageSize: figure,
    }),
    stack: z.array(z.object({ name: z.string(), role: z.string() })),
    /** The first is the card's and the hero's picture. */
    screenshots: z.tuple([screenshot], screenshot),
    /** Order on /showcase. */
    order: z.number(),
  }),
})

export const collections = { showcase }
