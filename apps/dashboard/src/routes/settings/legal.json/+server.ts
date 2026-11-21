import { json } from '@sveltejs/kit'
import { getLegal } from '#lib/server/agent.ts'
import type { RequestHandler } from './$types'

/**
 * The legal facts as a file: the record of processing (GDPR Art. 30) the owner keeps, and what
 * every app gets as LEGAL_FACTS (ADR 0043).
 */
export const GET: RequestHandler = async () => {
  const { facts } = await getLegal()
  return json(facts, {
    headers: {
      'content-disposition': `attachment; filename="legal-facts-${facts.updated}.json"`,
      'cache-control': 'no-store',
    },
  })
}
