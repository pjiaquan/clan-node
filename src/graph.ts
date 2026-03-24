import type { Hono } from 'hono';
import type { AppBindings, Person, Relationship } from './types';
import { safeParse } from './utils';
import { calculateKinship } from './kinship';
import { loadKinshipLabelMap, resolveKinshipLabel, trackKinshipLabelDefaults } from './kinship_labels';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  migratePlaintextCustomFieldRows,
  migratePlaintextPersonRow
} from './data_protection';

export function registerGraphRoutes(app: Hono<AppBindings>) {
  let peopleSchemaSupportPromise: Promise<{ hasEmail: boolean }> | null = null;
  const getPeopleSchemaSupport = async (db: D1Database) => {
    if (!peopleSchemaSupportPromise) {
      peopleSchemaSupportPromise = (async () => {
        const pragma = await db.prepare("PRAGMA table_info('people')").all();
        const names = new Set((pragma.results as Array<Record<string, unknown>>).map((row) => String((row as any).name)));
        if (!names.has('email')) {
          await db.prepare('ALTER TABLE people ADD COLUMN email TEXT').run();
          names.add('email');
        }
        return { hasEmail: names.has('email') };
      })().catch((error) => {
        peopleSchemaSupportPromise = null;
        throw error;
      });
    }
    return peopleSchemaSupportPromise;
  };

  const loadAvatarMap = async (db: D1Database) => {
    const { results } = await db.prepare(
      `SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
       FROM person_avatars
       ORDER BY person_id ASC, is_primary DESC, sort_order ASC, created_at ASC`
    ).all();
    const map = new Map<string, any[]>();
    results.forEach((row: any) => {
      const list = map.get(row.person_id) || [];
      list.push({
        id: String(row.id),
        person_id: String(row.person_id),
        avatar_url: String(row.avatar_url),
        storage_key: row.storage_key ? String(row.storage_key) : null,
        is_primary: Number(row.is_primary) === 1,
        sort_order: Number(row.sort_order ?? 0),
        created_at: row.created_at ?? null,
        updated_at: row.updated_at ?? null
      });
      map.set(String(row.person_id), list);
    });
    return map;
  };

  const resolvePrimaryAvatarUrl = (avatars: any[], fallback: string | null | undefined) => {
    const primary = avatars.find((avatar) => avatar.is_primary) || avatars[0] || null;
    return primary?.avatar_url || fallback || null;
  };

  // Get graph data centered on a person with kinship titles
  app.get('/api/graph', async (c) => {
    try {
      const centerId = c.req.query('center');
      console.log('GET /api/graph request for center:', centerId);
      const depth = parseInt(c.req.query('depth') || '3');

      if (!centerId) {
        return c.json({ error: 'center query parameter is required' }, 400);
      }
      const peopleSchema = await getPeopleSchemaSupport(c.env.DB);

      // Verify center person exists
      console.log('Verifying center person...');
      const center = await c.env.DB.prepare(
        `SELECT id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod FROM people WHERE id = ?`
      ).bind(centerId).first();

      if (!center) {
        console.log('Center person not found');
        return c.json({ error: 'Center person not found' }, 404);
      }
      await migratePlaintextPersonRow(c.env.DB, c.env, center as Record<string, unknown>);
      const decryptedCenter = await decryptPersonRow(c.env, center as Record<string, unknown>);

      // Get all people
      console.log('Fetching all people...');
      const { results: peopleRaw } = await c.env.DB.prepare(
        `SELECT id, name, english_name, ${peopleSchema.hasEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people`
      ).all();
      console.log(`Fetched ${peopleRaw.length} people`);
      await Promise.all((peopleRaw as any[]).map((person) => migratePlaintextPersonRow(c.env.DB, c.env, person as Record<string, unknown>)));
      const avatarMap = await loadAvatarMap(c.env.DB);

      const { results: customFieldRows } = await c.env.DB.prepare(
        'SELECT id, person_id, label, value FROM person_custom_fields'
      ).all();
      await migratePlaintextCustomFieldRows(c.env.DB, c.env, customFieldRows as Array<Record<string, unknown>>);
      const decryptedCustomFieldRows = await decryptCustomFieldRows(c.env, customFieldRows as Array<Record<string, unknown>>);
      const customFieldMap = new Map<string, { label: string; value: string }[]>();
      decryptedCustomFieldRows.forEach((row: any) => {
        const list = customFieldMap.get(row.person_id) || [];
        list.push({ label: row.label, value: row.value });
        customFieldMap.set(row.person_id, list);
      });

      const people = await Promise.all(peopleRaw.map(async (person: any) => {
        const decryptedPerson = await decryptPersonRow(c.env, person as Record<string, unknown>);
        const avatars = avatarMap.get(String(person.id)) || [];
        return {
          ...decryptedPerson,
          avatar_url: resolvePrimaryAvatarUrl(avatars, decryptedPerson.avatar_url as string | null | undefined),
          avatars,
          metadata: {
            ...safeParse(decryptedPerson.metadata as string),
            customFields: customFieldMap.get((decryptedPerson as any).id) || []
          }
        };
      }));
      const kinshipPeople: Person[] = people.map((person: any) => ({
        id: String(person.id),
        name: String(person.name),
        english_name: person.english_name ?? null,
        email: person.email ?? null,
        gender: String(person.gender),
        dob: person.dob ?? undefined,
        title: person.title,
        formal_title: person.formal_title
      }));

      // Get all relationships
      console.log('Fetching all relationships...');
      const { results: relationshipsRaw } = await c.env.DB.prepare(
        'SELECT * FROM relationships'
      ).all();
      console.log(`Fetched ${relationshipsRaw.length} relationships`);

      const relationships = relationshipsRaw.map((rel: any) => ({
        ...rel,
        metadata: safeParse(rel.metadata as string)
      }));
      const kinshipRelationships: Relationship[] = relationships.map((rel: any) => ({
        id: Number(rel.id),
        from_person_id: String(rel.from_person_id),
        to_person_id: String(rel.to_person_id),
        type: String(rel.type)
      }));
      const kinshipLabelMap = await loadKinshipLabelMap(c.env.DB);
      const observedKinshipDefaults: Array<{ default_title: string; default_formal_title: string }> = [];

      // Calculate kinship titles for each person relative to center
      console.log('Calculating kinship titles...');
      const graphNodes = people.map((person: any) => {
        try {
          if (person.id === centerId) {
            const resolved = resolveKinshipLabel(kinshipLabelMap, '我', '我');
            observedKinshipDefaults.push({
              default_title: '我',
              default_formal_title: '我',
            });
            return { ...person, title: resolved.title, formal_title: resolved.formalTitle };
          }
          const { title, formalTitle } = calculateKinship(centerId, person.id, kinshipRelationships, kinshipPeople, decryptedCenter as any);
          observedKinshipDefaults.push({
            default_title: title,
            default_formal_title: formalTitle,
          });
          const resolved = resolveKinshipLabel(kinshipLabelMap, title, formalTitle);
          return { ...person, title: resolved.title, formal_title: resolved.formalTitle };
        } catch (err) {
          console.error(`Error calculating title for person ${person.id}:`, err);
          return { ...person, title: 'Error' };
        }
      });

      const sessionUser = c.get('sessionUser');
      if (sessionUser?.role === 'admin') {
        try {
          await trackKinshipLabelDefaults(c.env.DB, observedKinshipDefaults);
        } catch (trackError) {
          console.warn('Failed to track kinship label defaults:', trackError);
        }
      }

      console.log('Graph data prepared successfully');
      return c.json({
        center: centerId,
        nodes: graphNodes,
        edges: relationships
      });
    } catch (error) {
      console.error('Fatal error in GET /api/graph:', error);
      return c.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}
