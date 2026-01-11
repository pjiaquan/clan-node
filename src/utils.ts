export function safeParse(str: string | null | undefined): any {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('Failed to parse JSON:', str, e);
    return null;
  }
}
