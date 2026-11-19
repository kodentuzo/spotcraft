import { redirect } from '@sveltejs/kit'
import { movedHref } from '#lib/nav.ts'
import type { RequestHandler } from './$types'

// Apps moved from /apps/<app> to /<app> (and their tabs to /<app>/<page>): old links follow.
export const GET: RequestHandler = ({ params, url }) => {
  redirect(308, movedHref(params.rest, url.searchParams.get('tab')))
}
