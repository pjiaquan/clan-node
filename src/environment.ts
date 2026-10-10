import type { Env } from './types';

/**
 * Environment detection.
 *
 * Cookie `Secure`/`SameSite`, HSTS, the `AUTH_ENCRYPTION_KEY` requirement, the
 * WebAuthn rpId and the passkey challenge key are all decided by comparing
 * `ENVIRONMENT` to the literal `'production'`. A value that merely looks right
 * -- `Production`, `production ` -- used to silently select the development
 * behaviour on a production deployment, so the comparison is normalized here
 * and anything unrecognized is rejected outright rather than downgraded.
 */
export const KNOWN_ENVIRONMENTS = ['production', 'development'] as const;

export type KnownEnvironment = typeof KNOWN_ENVIRONMENTS[number];

const normalize = (env: Env) => (env.ENVIRONMENT || '').trim().toLowerCase();

export const isProductionEnv = (env: Env) => normalize(env) === 'production';

export const isDevelopmentEnv = (env: Env) => normalize(env) === 'development';

/** False for an unset, misspelled or otherwise unrecognized `ENVIRONMENT`. */
export const isKnownEnvironment = (env: Env) => (
  (KNOWN_ENVIRONMENTS as readonly string[]).includes(normalize(env))
);
