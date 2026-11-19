/**
 * An app's hosts as a PromQL matcher for Caddy's `host` label (ADR 0038): `host=~"a\\.b|…"`.
 * Hosts come from the agent, which only accepts domain names; anything else could change the
 * query, so it is refused here whatever the caller checked.
 */
const HOST = /^[a-z0-9.-]+$/

export function hostLabel(names: string[]): string {
  if (names.length === 0 || !names.every((host) => HOST.test(host))) throw new Error('Bad host')
  return `host=~"${names.map((host) => host.replaceAll('.', '\\\\.')).join('|')}"`
}
