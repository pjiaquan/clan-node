import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Type definitions for Cloudflare Workers environment
type Env = {
  DB: D1Database;
  AVATARS: R2Bucket;
};

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for frontend
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', (c) => {
  return c.json({ status: 'ok', message: 'Clan Node API' });
});

// Helper for safe JSON parsing
function safeParse(str: string | null | undefined): any {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('Failed to parse JSON:', str, e);
    return null;
  }
}

// ============================================================================
// PEOPLE ENDPOINTS
// ============================================================================

// Get all people
app.get('/api/people', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, avatar_url, metadata FROM people ORDER BY created_at'
  ).all();
  
  const parsedResults = results.map(person => ({
    ...person,
    metadata: safeParse(person.metadata as string)
  }));
  
  return c.json(parsedResults);
});

// Get a single person by ID
app.get('/api/people/:id', async (c) => {
  const id = c.req.param('id');
  const person = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, avatar_url, metadata FROM people WHERE id = ?'
  ).bind(id).first();

  if (!person) {
    return c.json({ error: 'Person not found' }, 404);
  }
  return c.json(person);
});

// Create a new person
app.post('/api/people', async (c) => {
  const body = await c.req.json();
  const { name, gender, dob, avatar_url, metadata } = body;

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO people (id, name, gender, dob, avatar_url, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, name, gender || 'O', dob || null, avatar_url || null, metadata ? JSON.stringify(metadata) : null, now, now).run();

  const person = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, avatar_url, metadata FROM people WHERE id = ?'
  ).bind(id).first();

  return c.json(person, 201);
});

// Update a person
app.put('/api/people/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, gender, dob, avatar_url, metadata } = body;

  const existing = await c.env.DB.prepare(
    'SELECT id FROM people WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({ error: 'Person not found' }, 404);
  }

  const now = new Date().toISOString();
  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (gender !== undefined) {
    updates.push('gender = ?');
    values.push(gender);
  }
  if (dob !== undefined) {
    updates.push('dob = ?');
    values.push(dob);
  }
  if (avatar_url !== undefined) {
    updates.push('avatar_url = ?');
    values.push(avatar_url);
  }
  if (metadata !== undefined) {
    updates.push('metadata = ?');
    values.push(JSON.stringify(metadata));
  }

  updates.push('updated_at = ?');
  values.push(now);
  values.push(id);

  await c.env.DB.prepare(
    `UPDATE people SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  const person = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, avatar_url, metadata FROM people WHERE id = ?'
  ).bind(id).first();

  return c.json(person);
});

// Delete a person
app.delete('/api/people/:id', async (c) => {
  const id = c.req.param('id');

  const result = await c.env.DB.prepare(
    'DELETE FROM people WHERE id = ?'
  ).bind(id).run();

  if (result.success && (result.meta.changes ?? 0) > 0) {
    return c.json({ success: true, id });
  }
  return c.json({ error: 'Person not found' }, 404);
});

// ============================================================================
// RELATIONSHIPS ENDPOINTS
// ============================================================================

// Get all relationships
app.get('/api/relationships', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM relationships ORDER BY created_at'
  ).all();

  const parsedResults = results.map(rel => ({
    ...rel,
    metadata: safeParse(rel.metadata as string)
  }));

  return c.json(parsedResults);
});

// Create a relationship (link two people)
app.post('/api/relationships', async (c) => {
  const body = await c.req.json();
  const { from_person_id, to_person_id, type, metadata } = body;

  if (!from_person_id || !to_person_id || !type) {
    return c.json({ error: 'from_person_id, to_person_id, and type are required' }, 400);
  }

  if (!['parent_child', 'spouse'].includes(type)) {
    return c.json({ error: 'type must be parent_child or spouse' }, 400);
  }

  if (from_person_id === to_person_id) {
    return c.json({ error: 'Cannot link a person to themselves' }, 400);
  }

  // Verify both people exist
  const [fromExists, toExists] = await Promise.all([
    c.env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(from_person_id).first(),
    c.env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(to_person_id).first()
  ]);

  if (!fromExists || !toExists) {
    return c.json({ error: 'One or both people not found' }, 404);
  }

  const now = new Date().toISOString();

  const result = await c.env.DB.prepare(
    'INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(from_person_id, to_person_id, type, metadata ? JSON.stringify(metadata) : null, now).run();

  const relationship = await c.env.DB.prepare(
    'SELECT * FROM relationships WHERE id = ?'
  ).bind(result.meta.last_row_id).first();

  return c.json(relationship, 201);
});

// Update a relationship
app.put('/api/relationships/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { type, metadata } = body;

    console.log(`PUT /api/relationships/${id}`, body);

    const existing = await c.env.DB.prepare(
      'SELECT id FROM relationships WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Relationship not found' }, 404);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (type !== undefined) {
      if (!['parent_child', 'spouse'].includes(type)) {
        return c.json({ error: 'type must be parent_child or spouse' }, 400);
      }
      updates.push('type = ?');
      values.push(type);
    }

    if (metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return c.json({ message: 'No changes provided' });
    }

    values.push(id);

    await c.env.DB.prepare(
      `UPDATE relationships SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const relationship = await c.env.DB.prepare(
      'SELECT * FROM relationships WHERE id = ?'
    ).bind(id).first();

    return c.json(relationship);
  } catch (error) {
    console.error('Error updating relationship:', error);
    return c.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// Delete a relationship
app.delete('/api/relationships/:id', async (c) => {
  try {
    const id = c.req.param('id');
    console.log(`DELETE /api/relationships/${id} request received`);

    const result = await c.env.DB.prepare(
      'DELETE FROM relationships WHERE id = ?'
    ).bind(id).run();

    console.log('Delete result:', JSON.stringify(result));

    if (result.success && (result.meta.changes ?? 0) > 0) {
      return c.json({ success: true, id });
    }
    return c.json({ error: 'Relationship not found' }, 404);
  } catch (error) {
    console.error('Error deleting relationship:', error);
    return c.json({ error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) }, 500);
  }
});

// ============================================================================
// GRAPH ENDPOINTS
// ============================================================================

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
      'SELECT id, name, gender, dob FROM people WHERE id = ?'
    ).bind(centerId).first();

    if (!center) {
      console.log('Center person not found');
      return c.json({ error: 'Center person not found' }, 404);
    }

    // Get all people
    console.log('Fetching all people...');
    const { results: peopleRaw } = await c.env.DB.prepare(
      'SELECT id, name, gender, dob, avatar_url, metadata FROM people'
    ).all();
    console.log(`Fetched ${peopleRaw.length} people`);

    const people = peopleRaw.map(person => ({
      ...person,
      metadata: safeParse(person.metadata as string)
    }));

    // Get all relationships
    console.log('Fetching all relationships...');
    const { results: relationshipsRaw } = await c.env.DB.prepare(
      'SELECT * FROM relationships'
    ).all();
    console.log(`Fetched ${relationshipsRaw.length} relationships`);

    const relationships = relationshipsRaw.map(rel => ({
      ...rel,
      metadata: safeParse(rel.metadata as string)
    }));

    // Calculate kinship titles for each person relative to center
    console.log('Calculating kinship titles...');
    const graphNodes = people.map((person: any) => {
      try {
        const title = person.id === centerId ? '我' : calculateKinshipTitle(centerId, person.id, relationships, people, center as any);
        return { ...person, title };
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

// ============================================================================
// KINSHIP CALCULATION
// ============================================================================

interface Relationship {
  id: number;
  from_person_id: string;
  to_person_id: string;
  type: string;
}

interface Person {
  id: string;
  name: string;
  gender: string;
  dob?: string;
}

// BFS to find path from center to target, then convert to kinship title
function calculateKinshipTitle(
  centerId: string,
  targetId: string,
  relationships: Relationship[],
  people: Person[],
  centerPerson: Person
): string {
  // Build adjacency list for graph traversal
  const adj = new Map<string, Array<{ id: string; type: string; direction: 'up' | 'down' | 'spouse' }>>();

  for (const r of relationships) {
    if (!r.from_person_id || !r.to_person_id) continue; // Skip invalid relationships

    if (!adj.has(r.from_person_id)) adj.set(r.from_person_id, []);
    if (!adj.has(r.to_person_id)) adj.set(r.to_person_id, []);

    const fromNode = adj.get(r.from_person_id);
    const toNode = adj.get(r.to_person_id);

    if (fromNode && toNode) {
      if (r.type === 'parent_child') {
        fromNode.push({ id: r.to_person_id, type: 'child', direction: 'down' });
        toNode.push({ id: r.from_person_id, type: 'parent', direction: 'up' });
      } else if (r.type === 'spouse') {
        fromNode.push({ id: r.to_person_id, type: 'spouse', direction: 'spouse' });
        toNode.push({ id: r.from_person_id, type: 'spouse', direction: 'spouse' });
      }
    }
  }

  // BFS to find shortest path
  const queue: Array<{ id: string; path: string[] }> = [{ id: centerId, path: [] }];
  const visited = new Set<string>([centerId]);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.id === targetId) {
      return pathToTitle(current.path, centerPerson, people, targetId);
    }

    const neighbors = adj.get(current.id) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor.id)) {
        visited.add(neighbor.id);
        queue.push({
          id: neighbor.id,
          path: [...current.path, neighbor.direction]
        });
      }
    }
  }

  return '未知';
}

// Convert path (array of directions) to Chinese kinship title
function pathToTitle(
  path: string[],
  centerPerson: Person,
  people: Person[],
  targetId: string
): string {
  const target = people.find(p => p.id === targetId);
  if (!target) return '未知';

  const pathStr = path.join('-');

  // Self (should be handled by caller, but safe to add)
  if (path.length === 0) return '我';

  // Direct relationships
  if (pathStr === 'up') return target.gender === 'M' ? '父親' : '母親';
  if (pathStr === 'down') return target.gender === 'M' ? '兒子' : '女兒';
  if (pathStr === 'spouse') return centerPerson.gender === 'M' ? '妻子' : '丈夫';

  // Siblings (up -> down)
  if (pathStr === 'up-down') {
    // Check age to distinguish Elder/Younger
    // This is simple approximation. Accurate age requires parsing DOB.
    const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
    const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
    
    // If no DOB, default to generic sibling
    if (!centerDob || !targetDob) return target.gender === 'M' ? '兄弟' : '姊妹';

    if (target.gender === 'M') {
      return targetDob < centerDob ? '哥哥' : '弟弟';
    } else {
      return targetDob < centerDob ? '姊姊' : '妹妹';
    }
  }

  // Grandparents
  if (pathStr === 'up-up') {
    // Distinguish paternal/maternal is hard without knowing WHICH parent we went up through.
    // We can try to look at the first 'up' node. 
    // But for now, generic titles:
    if (target.gender === 'M') return '祖父/外祖父';
    return '祖母/外祖母';
  }

  // Grandchildren
  if (pathStr === 'down-down') {
    if (target.gender === 'M') return '孫子/外孫';
    return '孫女/外孫女';
  }

  // Child-in-law (down -> spouse)
  if (pathStr === 'down-spouse') {
    return target.gender === 'M' ? '女婿' : '媳婦';
  }

  // Sibling-in-law (up -> down -> spouse)
  if (pathStr === 'up-down-spouse') {
    if (target.gender === 'M') return '姊夫/妹夫'; // Husband of sister
    return '嫂嫂/弟媳'; // Wife of brother
  }
  
  // Spouse's sibling (spouse -> up -> down) -- Wait, spouse's parent's child
  // Path would be spouse-up-down
  if (pathStr === 'spouse-up-down') {
    if (target.gender === 'M') return '大伯/小叔/內兄/內弟';
    return '大姑/小姑/姨姐/姨妹';
  }

  // Siblings (same parents, requires checking if share parents)
  if (pathStr === 'spouse-down') {
    // Spouse's child (step-child)
    return target.gender === 'M' ? '繼子' : '繼女';
  }

  // Parent's siblings
  if (pathStr.startsWith('up-spouse') || pathStr.startsWith('up-down-spouse')) { // This logic was a bit fuzzy in old version
    // up-up-down is uncle/aunt
  }

  // Handle up-up-down (grandparent's child = parent's sibling)
  if (pathStr === 'up-up-down') {
    if (target.gender === 'M') return '伯父/叔叔/舅舅';
    return '姑姑/阿姨';
  }
  
  // Parent-in-law (spouse -> up)
  if (pathStr === 'spouse-up') {
    if (target.gender === 'M') return '岳父/公公';
    return '岳母/婆婆';
  }

  // Cousins (parent's sibling's child: up-up-down-down)
  if (pathStr === 'up-up-down-down') {
     return '堂/表兄弟姊妹';
  }

  // Default: show path for debugging
  return pathStr;
}

export default app;
