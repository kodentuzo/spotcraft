import { AgentUnavailable, getSettings } from '#lib/server/agent.ts'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  try {
    return { settings: await getSettings(), agentError: null }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { settings: null, agentError: message }
  }
}
