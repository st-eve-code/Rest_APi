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
} as const;

export type Config = typeof config;