import { NAME, RESERVED_NAMES } from '@spotcraft/agent/app-spec'
import { defineParams } from '@sveltejs/kit/params'

const appName = new RegExp(NAME)

/**
 * Whether a URL segment is a name the agent accepts. Reserved names include the dashboard's own
 * pages, so `/usage` is never an app called `usage`.
 */
export const isAppName = (param: string) => appName.test(param) && !RESERVED_NAMES.has(param)

/**
 * Route params. `[name=name]`: app names, so a crafted link such as `/blog%3Fpurge=true` is a
 * 404 rather than a value pasted into an agent URL.
 */
export const params = defineParams({
  name: (param) => (isAppName(param) ? param : undefined),
})
