import { customHosts } from '@spotcraft/agent/app-spec'
import { getDomainStatus } from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await appOr404(params.name)
  return {
    app,
    // The hosts Spotcraft gives the app; custom ones come with their DNS status, streamed.
    own: app.hostnames.filter((host) => !customHosts(app).includes(host)),
    custom: app.domain ? getDomainStatus(app.name).catch(() => undefined) : null,
  }
}
