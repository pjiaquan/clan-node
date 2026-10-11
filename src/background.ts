import type { Context } from 'hono';
import type { AppBindings } from './types';

/**
 * The request's ExecutionContext, or null when there is none.
 *
 * Hono's `c.executionCtx` getter *throws* when the context was not given one,
 * which the Cloudflare runtime always provides but the self-hosted Node server
 * does not. Both `if (c.executionCtx)` and `c.executionCtx?.waitUntil(...)`
 * therefore threw on self-host -- optional chaining does not help, because the
 * getter runs first -- so routes that scheduled background work answered 500
 * there.
 */
type BackgroundHost = { waitUntil: (promise: Promise<unknown>) => void };

export const tryExecutionCtx = (c: Context<AppBindings>): BackgroundHost | null => {
  try {
    return c.executionCtx ?? null;
  } catch {
    return null;
  }
};

/**
 * Runs `task` without blocking the response.
 *
 * On Workers this hands it to `waitUntil` so the isolate stays alive; without
 * an ExecutionContext the promise is simply left to run, which is what the
 * long-lived Node process can do anyway. Either way a rejection is logged
 * rather than left unhandled.
 */
export const runInBackground = (
  c: Context<AppBindings>,
  task: Promise<unknown>,
  description: string
) => {
  const guarded = task.catch((error) => {
    console.error(`Background task failed (${description}):`, error);
  });
  tryExecutionCtx(c)?.waitUntil(guarded);
};

/** A `waitUntil`-style scheduler for helpers that take one, or undefined. */
export const backgroundScheduler = (c: Context<AppBindings>, description: string) => {
  return (task: Promise<unknown>) => runInBackground(c, task, description);
};
