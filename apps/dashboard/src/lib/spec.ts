import type { AppStatus } from '@spotcraft/agent/apps'

/**
 * The settings of an app as the agent takes them back (`PUT /apps/:name`): what it reports
 * about the app (state, hosts, last deploy…) left out, since it refuses unknown fields.
 */
export function specOf(app: AppStatus) {
  const { name: _, state, health, status, hostnames, lastDeploy, ...input } = app
  return input
}
