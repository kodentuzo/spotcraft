import { appLogs } from '#lib/server/agent.ts'
import { appOr404 } from '#lib/server/app-data.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params }) => {
  const [app, logs] = await Promise.all([appOr404(params.name), appLogs(params.name, 200)])
  return { app, logs }
}
