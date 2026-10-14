import { runInBackground } from './background';
import type { Hono } from 'hono';
import type { AppBindings, Gender, Person, Relationship, RelationshipType } from './types';
import { safeParse, safeParseObject } from './utils';
import { calculateKinshipMany } from './kinship';
import { loadKinshipLabelMap, resolveKinshipLabel, trackKinshipLabelDefaults } from './kinship_labels';
import { createGraphRepository } from './d1_repositories';
import {
  decryptCustomFieldRows,
  decryptPersonRow,
  migratePlaintextCustomFieldRows,
  migratePlaintextPersonRow
} from './data_protection';
import { assertLayerExists, ensureLayerSchemaSupport, resolveLayerId } from './layers';
import { getPeopleSchemaSupport } from './schema';

export function registerGraphRoutes(app: Hono<AppBindings>) {
  const resolvePrimaryAvatarUrl = (avatars: any[], fallback: string | null | undefined) => {
    const primary = avatars.find((avatar) => avatar.is_primary) || avatars[0] || null;
    return primary?.avatar_url || fallback || null;
  };

  // Get graph data centered on a person with kinship titles
  app.get('/api/graph', async (c) => {
    try {
      const centerId = c.req.query('center');
      const layerId = resolveLayerId(c);
      // There was a `depth` query parameter here, parsed and bounded to 10
      // with a comment claiming it prevented expensive queries. It was never
      // used -- the whole layer is always loaded -- so the bound did not
      // exist. Removed rather than left as a false reassurance; bounding the
      // size of a returned graph is a separate design decision, and the
      // client renders the entire layer today.
      if (!centerId) {
        return c.json({ error: 'center query parameter is required' }, 400);
      }
      await ensureLayerSchemaSupport(c.env.DB);
      if (!await assertLayerExists(c.env.DB, layerId)) {
        return c.json({ error: 'Layer not found' }, 404);
      }
      const peopleSchema = await getPeopleSchemaSupport(c.env.DB);
      const graphRepository = createGraphRepository(c.env);

      // Verify center person exists
      const center = await graphRepository.getCenterPerson(layerId, centerId, peopleSchema.hasEmail);

      if (!center) {
        return c.json({ error: 'Center person not found' }, 404);
      }
      const decryptedCenter = await decryptPersonRow(c.env, center as Record<string, unknown>);
      runInBackground(
        c,
        migratePlaintextPersonRow(c.env.DB, c.env, center as Record<string, unknown>),
        'center person migration'
      );

      const [peopleRaw, avatarRows, customFieldRows, relationshipsRaw] = await Promise.all([
        graphRepository.listPeople(layerId, peopleSchema.hasEmail),
        graphRepository.listAvatarRows(layerId),
        graphRepository.listCustomFieldRows(layerId),
        graphRepository.listRelationships(layerId)
      ]);

      // Bolt Optimization: Replace forEach with index-based loop and consolidate map lookups
      const avatarMap = new Map<string, typeof avatarRows>();
      for (let i = 0; i < avatarRows.length; i++) {
        const avatar = avatarRows[i];
        let list = avatarMap.get(avatar.person_id);
        if (list === undefined) {
          list = [];
          avatarMap.set(avatar.person_id, list);
        }
        list.push(avatar);
      }

      // Decrypt custom fields and list verified emails concurrently
      const [decryptedCustomFieldRows, verifiedEmailMap] = await Promise.all([
        decryptCustomFieldRows(c.env, customFieldRows),
        graphRepository.listVerifiedEmails(
          peopleRaw.map((person) => person.email as string | null | undefined)
        )
      ]);

      // Bolt Optimization: Replace forEach with index-based loop and consolidate map lookups
      const customFieldMap = new Map<string, { label: string; value: string }[]>();
      for (let i = 0; i < decryptedCustomFieldRows.length; i++) {
        const row = decryptedCustomFieldRows[i] as any;
        let list = customFieldMap.get(row.person_id);
        if (list === undefined) {
          list = [];
          customFieldMap.set(row.person_id, list);
        }
        list.push({ label: row.label, value: row.value });
      }

      const people = await Promise.all(peopleRaw.map(async (person: any) => {
        const decryptedPerson = await decryptPersonRow(c.env, person as Record<string, unknown>);
        const avatars = avatarMap.get(String(person.id)) || [];
        return {
          ...decryptedPerson,
          layer_id: layerId,
          email_verified_at: decryptedPerson.email
            ? (verifiedEmailMap.get(String(decryptedPerson.email).trim().toLowerCase()) ?? null)
            : null,
          avatar_url: resolvePrimaryAvatarUrl(avatars, decryptedPerson.avatar_url as string | null | undefined),
          avatars,
          metadata: {
            ...(safeParseObject(decryptedPerson.metadata as string) ?? {}),
            customFields: customFieldMap.get((decryptedPerson as any).id) || []
          }
        };
      }));
      const kinshipPeople: Person[] = people.map((person: any) => ({
        id: String(person.id),
        layer_id: String(person.layer_id ?? layerId),
        name: String(person.name),
        english_name: person.english_name ?? null,
        email: person.email ?? null,
        gender: String(person.gender) as Gender,
        dob: person.dob ?? undefined,
        title: person.title,
        formal_title: person.formal_title
      }));

      const relationships = relationshipsRaw.map((rel: any) => ({
        ...rel,
        metadata: safeParse(rel.metadata as string)
      }));
      const kinshipRelationships: Relationship[] = relationships.map((rel: any) => ({
        id: Number(rel.id),
        layer_id: String(rel.layer_id ?? layerId),
        from_person_id: String(rel.from_person_id),
        to_person_id: String(rel.to_person_id),
        type: String(rel.type) as RelationshipType
      }));
      const kinshipLabelMap = await loadKinshipLabelMap(c.env.DB);
      const observedKinshipDefaults: Array<{ default_title: string; default_formal_title: string }> = [];
      const kinshipResults = calculateKinshipMany({
        centerId,
        targetIds: people.map((person: any) => String(person.id)),
        relationships: kinshipRelationships,
        people: kinshipPeople,
        centerPerson: decryptedCenter as any,
      });

      // Calculate kinship titles for each person relative to center
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
          const { title, formalTitle } = kinshipResults.get(String(person.id)) ?? { title: '未知', formalTitle: '未知' };
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

      return c.json({
        layer_id: layerId,
        center: centerId,
        nodes: graphNodes,
        edges: relationships
      });
    } catch (error) {
      console.error('Fatal error in GET /api/graph:', error);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });
}
