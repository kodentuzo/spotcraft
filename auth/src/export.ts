import type { BetterAuthPlugin } from 'better-auth'
import { createAuthEndpoint, sensitiveSessionMiddleware } from 'better-auth/api'

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null

/**
 * `GET /_spotcraft/auth/export`: everything the pool holds about the signed-in user, as JSON
 * (ADR 0043). Apps export their own rows; a your-data page puts both in one download. Secrets
 * (session tokens, password hashes, OAuth tokens) are left out: they are credentials, not data
 * about the user. The session is checked against the database, not a cookie cache.
 */
export const exportPlugin = () =>
  ({
    id: 'spotcraft-export',
    endpoints: {
      exportUser: createAuthEndpoint(
        '/export',
        { method: 'GET', use: [sensitiveSessionMiddleware] },
        async (ctx) => {
          const { user } = ctx.context.session
          const [sessions, accounts] = await Promise.all([
            ctx.context.internalAdapter.listSessions(user.id),
            ctx.context.internalAdapter.findAccounts(user.id),
          ])
          ctx.setHeader('cache-control', 'no-store')
          ctx.setHeader('content-disposition', 'attachment; filename="account.json"')
          return ctx.json({
            exportedAt: new Date().toISOString(),
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              emailVerified: user.emailVerified,
              image: user.image ?? null,
              isAnonymous: Boolean(user.isAnonymous),
              createdAt: iso(user.createdAt),
              updatedAt: iso(user.updatedAt),
            },
            sessions: sessions.map((session) => ({
              createdAt: iso(session.createdAt),
              updatedAt: iso(session.updatedAt),
              expiresAt: iso(session.expiresAt),
              ipAddress: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null,
              host: (session as { host?: string | null }).host ?? null,
              client: (session as { client?: string | null }).client ?? null,
            })),
            accounts: accounts.map((account) => ({
              providerId: account.providerId,
              accountId: account.accountId,
              scope: account.scope ?? null,
              createdAt: iso(account.createdAt),
              updatedAt: iso(account.updatedAt),
            })),
          })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
