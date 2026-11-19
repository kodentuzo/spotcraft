import type pg from 'pg'

/**
 * Deletes guests nobody has used for `days`: created before then, with no session used since.
 * Their rows in every app go with them, through the apps' cascading foreign keys (ADR 0035).
 * Each guest is deleted on its own, so one an app's foreign key blocks (a bug in that app)
 * doesn't stop the rest; those are counted and named by the error.
 */
export async function deleteIdleGuests(
  db: pg.Pool,
  days: number,
  batch = 500,
): Promise<{ deleted: number; blocked: string[] }> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT u.id FROM auth.users u
     WHERE u.is_anonymous AND u.created_at < now() - make_interval(days => $1)
       AND NOT EXISTS (
         SELECT 1 FROM auth.sessions s
         WHERE s.user_id = u.id AND s.updated_at >= now() - make_interval(days => $1))
     ORDER BY u.created_at
     LIMIT $2`,
    [days, batch],
  )
  let deleted = 0
  const blocked: string[] = []
  for (const { id } of rows) {
    try {
      deleted += (await db.query('DELETE FROM auth.users WHERE id = $1', [id])).rowCount ?? 0
    } catch (error) {
      blocked.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { deleted, blocked: [...new Set(blocked)] }
}
