type JsonRequest = {
  json: () => Promise<unknown>;
};

export async function readJsonObjectBody(req: JsonRequest): Promise<Record<string, unknown> | null> {
  const parsed = await req.json().catch(() => null);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}
