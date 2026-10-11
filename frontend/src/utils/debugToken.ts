/**
 * Display helpers for the `debug_*` fields the API can return in a local
 * development environment (MFA codes, invite and e-mail verification tokens).
 *
 * These are single-use authentication secrets. A production build must never
 * render one, even if a misconfigured backend sends it, so every display site
 * goes through here instead of interpolating the field directly.
 */
const debugTokensAllowed = () => !import.meta.env.PROD;

/** Returns ` (<token>)` for local development, and '' in a production build. */
export const debugTokenSuffix = (
  token: string | null | undefined,
  format: (value: string) => string = (value) => ` (${value})`
): string => (
  token && debugTokensAllowed() ? format(token) : ''
);

/** Drops a debug token before it is persisted or stored in state. */
export const keepDebugToken = <T extends string | null | undefined>(token: T): T | undefined => (
  token && debugTokensAllowed() ? token : undefined
);
