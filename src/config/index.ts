import 'dotenv/config';
import { z } from 'zod';

/**
 * Loads and validates environment variables ONCE, at startup.
 *
 * Why bother?
 *  - If DATABASE_URL is missing, the app dies immediately with a clear message
 *    instead of crashing later with "connect ECONNREFUSED" from some random place.
 *  - TypeScript now knows `config.port` is a `number`, not `string | undefined`.
 *
 * zod v4 uses `z.coerce` to convert text into numbers/booleans, because
 * everything in a .env file is a string by definition.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().max(65535).default(3000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'DATABASE_URL must start with postgres:// or postgresql://',
    ),

  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Which storage engine the app should use.
   *
   *   memory   -> a plain JavaScript array. No database required. Data resets
   *               every time you restart the server. Perfect for learning the
   *               API without installing anything.
   *   postgres -> real PostgreSQL. Data survives restarts.
   *
   * Both options implement the exact same ItemRepository interface, so switching
   * between them changes NOTHING outside this config file.
   */
  DB_DRIVER: z.enum(['memory', 'postgres']).default('memory'),

  DATABASE_LOG_QUERIES: z
    .enum(['true', 'false'])
    .default('false')
    // Transform the text "true"/"false" into a real boolean.
    .transform((value) => value === 'true'),

  CORS_ORIGIN: z.string().default('*'),

  /**
   * =============================================================================
   * JWT / AUTHENTICATION
   * =============================================================================
   *
   * A JWT is signed, not encrypted: anyone holding it can read the claims, but
   * only the holder of the secret can produce one the server accepts. So the
   * secret is the entire security boundary -- keep it out of git, rotate it if
   * it leaks, and never reuse it across environments.
   */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  /**
   * Refresh tokens are signed with a DIFFERENT secret.
   *
   * Why: it makes the two token types cryptographically independent. If an
   * access token ever leaks, an attacker still cannot mint a refresh token, and
   * revoking refresh sessions cannot be undone by replaying an access token.
   */
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  /** Access tokens are deliberately short-lived: less time to steal, more 401s. */
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+[smhd]?$/, 'JWT_ACCESS_TTL must look like 900, 15m, 12h or 7d')
    .default('15m'),

  /** Refresh tokens are long-lived, because they are only usable once. */
  JWT_REFRESH_TTL: z
    .string()
    .regex(/^\d+[smhd]?$/, 'JWT_REFRESH_TTL must look like 900, 15m, 12h or 7d')
    .default('7d'),

  /** Issuer claim. Lets us tell our own tokens apart from anyone else's. */
  JWT_ISSUER: z.string().default('ado_test_core'),

  /** The web UI's origin. Used to set CORS on the auth routes and to document cookie use. */
  AUTH_COOKIE_NAME: z.string().default('refresh_token'),
});

/**
 * If validation fails, zod gives us a big list of problems. We print them in a
 * readable way and kill the process -- a half-configured server is worse than
 * no server, because it fails confusingly later.
 */
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:\n');

  for (const issue of parsed.error.issues) {
    // Skip DATABASE_URL when it is simply absent, we already say it above.
    const key = issue.path.join('.') || '(root)';
    console.error(`  - ${key}: ${issue.message}`);
  }

  console.error(
    '\nFix the values above (copy .env.example to .env) and try again.',
  );
  process.exit(1);
}

const env = parsed.data;

/**
 * Refuse to boot in production with a placeholder secret.
 *
 * Development convenience ("just use the example secret so the app runs") is how
 * real breaches happen: the secret ships to production, is published in a repo,
 * and anyone can mint a token for any user. Failing loudly here is cheap; a
 * compromised production account is not.
 */
if (env.NODE_ENV === 'production') {
  const placeholders = ['change-me', 'CHANGE_ME', 'secret', 'test', 'development'];

  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[key].toLowerCase();

    if (placeholders.some((needle) => value.includes(needle))) {
      console.error(
        `Invalid environment variables:\n  - ${key}: looks like a placeholder value.\n` +
          '    Generate real secrets, e.g.:\n' +
          `      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
      );
      process.exit(1);
    }
  }
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  databasePoolMax: env.DATABASE_POOL_MAX,
  databaseLogQueries: env.DATABASE_LOG_QUERIES,
  dbDriver: env.DB_DRIVER,
  /** Only connect to a database at all when the driver says so. */
  usesDatabase: env.DB_DRIVER === 'postgres',
  corsOrigin: env.CORS_ORIGIN,
  jwt: {
    secret: env.JWT_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
    issuer: env.JWT_ISSUER,
    refreshCookieName: env.AUTH_COOKIE_NAME,
  },
} as const;

export type Config = typeof config;