/**
 * =============================================================================
 * PASSWORD STORAGE
 * =============================================================================
 *
 * THE RULE: never store a password. Store a hash of it, and never try to undo
 * that hash. There is no "decrypt password" function, and a system that has one
 * has already lost.
 *
 * WHY NOT SHA-256 (the obvious choice)?
 *
 * SHA-256 is designed to be FAST -- a modern GPU computes billions per second,
 * so an attacker who steals a database of SHA-256 hashes can try billions of
 * password guesses per second. Password hashing deliberately does the opposite:
 * it is SLOW and memory-hard.
 *
 * bcrypt is what we use because it is battle-tested, ships with no native build
 * step in this project, and its cost is configurable: `cost` (rounds) can be
 * raised as hardware gets faster, and old hashes stay valid because the cost is
 * stored inside the hash string itself.
 *
 * `bcryptjs` (pure JavaScript) is used rather than `bcrypt` (native addon) so
 * the project installs cleanly on any machine without a compiler toolchain.
 * The format is identical.
 *
 * =============================================================================
 */
import bcrypt from 'bcryptjs';

/**
 * How many times to run the hashing function.
 *
 * Cost 10 is ~60-100ms on typical server hardware -- slow enough to make
 * brute-forcing expensive, fast enough that logging in still feels instant.
 * Higher is slower AND safer; 12+ is right for a busy production service.
 */
const BCRYPT_COST = 10;

/**
 * The one-way door: plaintext -> hash.
 *
 * `bcrypt` automatically salts each hash with a random salt and embeds it in the
 * output, so two users with the password "hunter2" get completely different
 * hashes. That is why comparing hashes works at all -- and why you must use
 * `compare` rather than `===`.
 *
 * `async` because it is CPU-heavy: running it synchronously would block the
 * event loop and stall every other request.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Checks a candidate password against a stored hash.
 *
 * Returns `false` instead of throwing on a malformed hash, so a corrupt row
 * denies access rather than crashing the login endpoint.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Rejects the passwords that appear at the top of every breach corpus.
 *
 * A 12-character passphrase like "correct horse battery" is both stronger and
 * easier to remember than "P@ssw0rd1". Length beats punctuation, so we demand
 * length first and only then ask for a little variety.
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  'qwerty123',
  'letmein123',
  'admin123',
  'welcome123',
  'iloveyou',
  'abc12345',
]);

export function isWeakPassword(plaintext: string): boolean {
  if (plaintext.length < 12) return true;
  if (COMMON_PASSWORDS.has(plaintext.toLowerCase())) return true;

  // "aaaaaaaaaaaaaaaaaaaa" is long but has almost no entropy. Requiring at least
  // three distinct character classes rules out the worst of these without
  // pushing people toward unreadable substitutions.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(plaintext),
  ).length;

  return classes < 3;
}