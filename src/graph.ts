import type { Hono } from 'hono';
import type { AppBindings, Person, Relationship } from './types';
import { safeParse } from './utils';
import { calculateKinship } from './kinship';

export function registerGraphRoutes(app: Hono<AppBindings>) {
  // Get graph data centered on a person with kinship titles
  app.get('/api/graph', async (c) => {
    try {
      const centerId = c.req.query('center');
      console.log('GET /api/graph request for center:', centerId);
      const depth = parseInt(c.req.query('depth') || '3');

      if (!centerId) {
        return c.json({ error: 'center query parameter is required' }, 400);
      }

      // Verify center person exists
      console.log('Verifying center person...');
      const center = await c.env.DB.prepare(
        'SELECT id, name, english_name, gender, dob, dod, tob, tod FROM people WHERE id = ?'
      ).bind(centerId).first();

      if (!center) {
        console.log('Center person not found');
        return c.json({ error: 'Center person not found' }, 404);
      }

      // Get all people
      console.log('Fetching all people...');
      const { results: peopleRaw } = await c.env.DB.prepare(
        'SELECT id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people'
      ).all();
      console.log(`Fetched ${peopleRaw.length} people`);

      const { results: customFieldRows } = await c.env.DB.prepare(
        'SELECT person_id, label, value FROM person_custom_fields'
      ).all();
      const customFieldMap = new Map<string, { label: string; value: string }[]>();
      customFieldRows.forEach((row: any) => {
        const list = customFieldMap.get(row.person_id) || [];
        list.push({ label: row.label, value: row.value });
        customFieldMap.set(row.person_id, list);
      });

      const people = peopleRaw.map(person => ({
        ...person,
        metadata: {
          ...safeParse(person.metadata as string),
          customFields: customFieldMap.get((person as any).id) || []
        }
      }));
      const kinshipPeople: Person[] = people.map((person: any) => ({
        id: String(person.id),
        name: String(person.name),
        english_name: person.english_name ?? null,
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

      // Calculate kinship titles for each person relative to center
      console.log('Calculating kinship titles...');
      const graphNodes = people.map((person: any) => {
        try {
          if (person.id === centerId) {
        return { ...person, title: '我', formal_title: '我' };
          }
          const { title, formalTitle } = calculateKinship(centerId, person.id, kinshipRelationships, kinshipPeople, center as any);
          return { ...person, title, formal_title: formalTitle };
        } catch (err) {
          console.error(`Error calculating title for person ${person.id}:`, err);
          return { ...person, title: 'Error' };
        }
      });

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
