import { closePool, pool } from './pool';

/**
 * Promotes an existing account to admin (or demotes it back to a normal user).
 *
 *   npm run db:make-admin -- you@example.com
 *   npm run db:make-admin -- you@example.com user
 *
 * WHY THIS IS A CLI AND NOT AN ENDPOINT
 *
 * There is no `POST /api/auth/promote`, and there never should be. Any endpoint
 * that can hand out admin rights is a privilege-escalation hole: if it is
 * reachable, a bug (or a stolen token) somewhere else becomes a full account
 * takeover. Admin is granted only by someone who already has database access --
 * i.e. already has server access, at which point "the web app let me in" is not
 * the thing standing between an attacker and the data.
 *
 * This is the standard rule: privilege changes are an operator action, performed
 * out of band, and every one of them is auditable in the database itself.
 *
 * Requires DB_DRIVER=postgres -- roles are a database concept, so there is
 * nothing to promote in an in-memory store.
 */

/** Normalises "ADMIN", " admin " and "Admin" to the canonical form. */
function parseRole(argument: string | undefined): 'admin' | 'user' {
  const value = (argument ?? 'admin').trim().toLowerCase();

  if (value === 'admin' || value === 'user') {
    return value;
  }

  console.error(`[make-admin] unknown role "${argument}" -- expected "admin" or "user"`);
  process.exit(1);
}

async function makeAdmin(): Promise<void> {
  // `npm run db:make-admin -- a@b.com` puts the value after "--". Reading
  // process.argv directly (rather than trusting a flag parser) keeps this
  // dependency-free, and the array is index 2 because argv[0] is node and
  // argv[1] is this script.
  const email = process.argv[2];
  const role = parseRole(process.argv[3]);

  if (!email) {
    console.error('Usage: npm run db:make-admin -- <email> [admin|user]');
    process.exit(1);
  }

  const result = await pool.query(
    `UPDATE users
        SET role = $2::user_role, updated_at = NOW()
      WHERE LOWER(email) = LOWER($1)
      RETURNING email, role`,
    [email, role],
  );

  if (result.rowCount === 0) {
    // Almost always a typo, or the account was created on a different database
    // (DB_DRIVER=memory forgets everyone on every restart).
    console.error(`[make-admin] no user with the email "${email}"`);
    console.error('[make-admin] register it first:  POST /api/auth/register');
    process.exit(1);
  }

  console.log(`[make-admin] ${result.rows[0].email} is now ${result.rows[0].role}`);
}

makeAdmin()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('[make-admin] failed:', error instanceof Error ? error.message : error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });