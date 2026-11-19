import { getUsage } from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await appOr404(params.name)
  // The pool is shared; for one app, its accounts are counted from sessions on its hosts.
  return {
    app,
    accounts: getUsage(app.name)
      .then((usage) => usage.accounts ?? null)
      .catch(() => null),
    now: Date.now(),
  }
}
