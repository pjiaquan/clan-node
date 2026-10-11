/**
 * Small field validators for request bodies.
 *
 * Write routes used to destructure the parsed JSON and hand the values
 * straight to D1. A non-string where a string was expected reached the bind
 * call and threw, which -- with no `app.onError` -- surfaced as an unhandled
 * 500 carrying the driver's message; a value outside a CHECK constraint did
 * the same from SQLite; and strings, arrays and JSON blobs had no size limit
 * at all.
 *
 * Each helper either returns a usable value or throws `ValidationError`, which
 * route handlers turn into a 400.
 */
export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.field = field;
  }
}

export const FIELD_LIMITS = {
  /** Names, labels and other short free text. */
  shortText: 200,
  /** Date and time fields, which are ISO-ish strings. */
  dateText: 40,
  /** Serialized `metadata`, measured in UTF-8 bytes. */
  metadataBytes: 16 * 1024,
  /** Entries in a `custom_fields` or `avatars` array. */
  arrayItems: 50,
} as const;

const textEncoder = new TextEncoder();

/** A string within `max` characters, or null for absent/empty. */
export const optionalText = (
  value: unknown,
  field: string,
  max: number = FIELD_LIMITS.shortText
): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(field, 'must be a string');
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new ValidationError(field, `must be at most ${max} characters`);
  return trimmed;
};

/** A non-empty string within `max` characters. */
export const requiredText = (
  value: unknown,
  field: string,
  max: number = FIELD_LIMITS.shortText
): string => {
  const text = optionalText(value, field, max);
  if (text === null) throw new ValidationError(field, 'is required');
  return text;
};

/** One of `allowed`, or null when absent. */
export const optionalEnum = <T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(field, `must be one of ${allowed.join(', ')}`);
  }
  return value as T;
};

/**
 * An identifier safe to use as a primary key: the shape `crypto.randomUUID`
 * produces, plus the slug-ish ids older data and layer seeds use.
 */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const optionalIdentifier = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new ValidationError(field, 'is not a valid identifier');
  }
  return value;
};

/** An array of at most `FIELD_LIMITS.arrayItems` entries. */
export const boundedArray = (value: unknown, field: string): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(field, 'must be an array');
  if (value.length > FIELD_LIMITS.arrayItems) {
    throw new ValidationError(field, `must have at most ${FIELD_LIMITS.arrayItems} entries`);
  }
  return value;
};

/**
 * Serializes a JSON-ish value, refusing anything whose encoded form exceeds
 * the byte cap. `metadata` is stored as a single TEXT column and read back on
 * every graph load, so an unbounded blob there is a cost everyone pays.
 */
export const boundedJson = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ValidationError(field, 'must be JSON-serializable');
  }
  if (serialized === undefined) throw new ValidationError(field, 'must be JSON-serializable');
  if (textEncoder.encode(serialized).byteLength > FIELD_LIMITS.metadataBytes) {
    throw new ValidationError(field, `must be at most ${FIELD_LIMITS.metadataBytes} bytes once encoded`);
  }
  return serialized;
};

/** A plain JSON object body, rather than an array, string or null. */
export const requireObjectBody = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('body', 'must be a JSON object');
  }
  return value as Record<string, unknown>;
};
