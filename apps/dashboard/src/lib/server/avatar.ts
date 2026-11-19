import { createHash } from 'node:crypto'

/**
 * Gravatar's image for an email: addressed by the SHA-256 of the trimmed, lower-cased address,
 * so the email itself never leaves the dashboard. `d=404` answers 404 for an email without one,
 * and the page shows the initial instead.
 */
export function gravatarUrl(email: string, size = 64): string {
  const hash = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `https://gravatar.com/avatar/${hash}?s=${size}&d=404`
}
