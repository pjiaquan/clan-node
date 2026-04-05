export function safeParse(str: string | null | undefined): unknown | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('Failed to parse JSON:', str, e);
    return null;
  }
}

export function safeParseObject(str: string | null | undefined): Record<string, unknown> | null {
  const parsed = safeParse(str);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}
