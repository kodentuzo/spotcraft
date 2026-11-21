import svelte from '@astrojs/svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// Static output and no client-side JavaScript; GitHub Pages serves dist/. Svelte components
// (@spotcraft/ui) render at build time only: no page uses a client: directive.
export default defineConfig({
  site: 'https://spotcraft.dev',
  output: 'static',
  integrations: [svelte()],
  // `/docs/security` is written as `docs/security.html`, which GitHub Pages serves at that URL
  // without a redirect, so the addresses stay as they were.
  build: { format: 'file' },
  trailingSlash: 'never',
  // Astro's dev toolbar injects scripts; the site has none.
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    // The docs are the repository's own Markdown (docs/, CHANGELOG.md), read at build time.
    server: { fs: { allow: ['../..'] } },
  },
})
