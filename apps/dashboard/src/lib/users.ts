/**
 * What to say when the list fails. An agent from before ADR 0040 refuses `?app=` as an unknown
 * parameter: say that plainly rather than repeat its validation message.
 */
export function listErrorMessage(error: unknown, app?: string): string {
  const message = error instanceof Error ? error.message : ''
  if (app && /additional properties/i.test(message)) {
    return "The server's agent is older than this dashboard and can't list one app's users yet. They show once both run the same version."
  }
  return message || 'The agent could not list the users'
}
