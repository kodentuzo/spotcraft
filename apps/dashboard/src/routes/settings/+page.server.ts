import { fail } from '@sveltejs/kit'
import { AgentUnavailable, getLegal, getSettings, setLegal } from '#lib/server/agent.ts'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  try {
    const [settings, legal] = await Promise.all([getSettings(), getLegal().catch(() => null)])
    return { settings, legal, agentError: null }
  } catch (error) {
    const message =
      error instanceof AgentUnavailable ? error.message : 'The agent returned an error'
    return { settings: null, legal: null, agentError: message }
  }
}

export const actions: Actions = {
  // The owner's details for the legal facts (ADR 0043); the agent checks them.
  legal: async ({ request }) => {
    const form = await request.formData()
    const field = (name: string) => String(form.get(name) ?? '')
    const owner = {
      name: field('name'),
      address: field('address'),
      email: field('email'),
      authority: { name: field('authorityName'), url: field('authorityUrl') },
      hosting: { name: field('hostingName'), country: field('hostingCountry') },
    }
    try {
      const { redeploying } = await setLegal(owner)
      return { legalSaved: true, redeploying }
    } catch (cause) {
      return fail(400, {
        legalError: cause instanceof Error ? cause.message : 'The details could not be saved',
        owner,
      })
    }
  },
}
