import { getSettings, listApps } from '#lib/server/agent.ts'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = ({ locals }) => ({
  authed: locals.authed,
  accessEmail: locals.accessEmail,
  // For the sidebar and the app switcher: streamed, so no page waits for them, and null when the
  // agent doesn't answer (the page itself says so). Not before login.
  apps: locals.authed
    ? listApps()
        .then((apps) =>
          apps
            .map(({ name, state, health }) => ({ name, state, health }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        .catch(() => null)
    : null,
  settings: locals.authed ? getSettings().catch(() => null) : null,
})
