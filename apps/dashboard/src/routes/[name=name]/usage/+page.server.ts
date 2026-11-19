import { appOr404, appUsage } from '#lib/server/app-data.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const app = await appOr404(params.name)
  return { app, usage: appUsage(app) }
}
