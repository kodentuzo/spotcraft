import { appHealth, appOr404 } from '#lib/server/app-data.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  // The app's container over the last day, a point every 15 minutes.
  const [app, health] = await Promise.all([
    appOr404(params.name),
    appHealth(params.name, 24 * 60, 900),
  ])
  return { app, health, now: Date.now() }
}
