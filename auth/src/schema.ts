import { boolean, index, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * The pool's tables in the `auth` schema of the instance database (ADR 0035). These Drizzle
 * definitions mirror the SQL migrations in ./migrations; a test checks that the two agree. The
 * property names are the field names Better Auth uses; the column names are snake_case.
 */
export const auth = pgSchema('auth')

const times = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const users = auth.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().default(''),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    ...times,
  },
  (t) => [index('users_created_at_idx').on(t.createdAt)],
)

export const sessions = auth.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...times,
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const accounts = auth.table(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    ...times,
  },
  (t) => [unique().on(t.providerId, t.accountId), index('accounts_user_id_idx').on(t.userId)],
)

export const verifications = auth.table(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...times,
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

export const jwks = auth.table('jwks', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  alg: text('alg'),
  crv: text('crv'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})
