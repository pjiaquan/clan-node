/**
 * Object-storage key validation.
 *
 * Avatar keys are minted server-side as `person-<uuid>-<ts>-<uuid>.<ext>` or
 * `user-<uuid>-<ts>-<uuid>.<ext>` and are always flat names inside the bucket.
 * On Cloudflare R2 a key containing `../` is just an object name, but the
 * self-hosted `LocalR2Bucket` maps keys onto the filesystem with `path.join`,
 * so an unvalidated key is a path traversal. Keys also reach the bucket from
 * values stored in D1 (`person_avatars.storage_key`, `avatar_url`), which a
 * backup import can supply, so DB-sourced keys are validated too.
 *
 * The check is a flat-filename character class rather than a full format match
 * so that keys minted by older versions keep working.
 */
const SAFE_STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export const isSafeStorageKey = (key: unknown): key is string => {
  if (typeof key !== 'string' || key.length === 0) return false;
  // `path.join(root, '..')` escapes the root even without a separator.
  if (key.includes('..')) return false;
  return SAFE_STORAGE_KEY.test(key);
};

/** Returns the key when it is safe to hand to the bucket, otherwise null. */
export const safeStorageKey = (key: unknown): string | null => (
  isSafeStorageKey(key) ? key : null
);
