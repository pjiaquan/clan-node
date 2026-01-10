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

async function linkParentsToInLaw(db: D1Database, childId: string, inLawId: string, now: string) {
  const { results: parents } = await db.prepare(
    "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
  ).bind(childId).all();

  if (!parents.length) return 0;

  for (const parent of parents) {
    const parentId = parent.from_person_id as string;
    const hasParentChild = await db.prepare(
      "SELECT id FROM relationships WHERE type = 'parent_child' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
    ).bind(parentId, inLawId, inLawId, parentId).first();
    if (hasParentChild) {
      continue;
    }

    const existingParentChild = await db.prepare(
      "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
    ).bind(parentId, inLawId).first();
    if (existingParentChild) {
      await db.prepare(
        "DELETE FROM relationships WHERE id = ?"
      ).bind((existingParentChild as any).id).run();
    }

    const exists = await db.prepare(
      "SELECT id FROM relationships WHERE type = 'in_law' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
    ).bind(parentId, inLawId, inLawId, parentId).first();

    if (!exists) {
      const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
      await db.prepare(
        "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'in_law', ?, ?)"
      ).bind(parentId, inLawId, meta, now).run();
    }
  }
  return parents.length;
}

async function shareParents(db: D1Database, personA: string, personB: string) {
  const { results: parentsA } = await db.prepare(
    "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
  ).bind(personA).all();
  const { results: parentsB } = await db.prepare(
    "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
  ).bind(personB).all();

  const parentSetA = new Set(parentsA.map(p => p.from_person_id));
  for (const p of parentsB) {
    if (parentSetA.has(p.from_person_id)) return true;
  }
  return false;
}

function getSurname(name: string | null | undefined) {
  if (!name) return '';
  return name.trim().charAt(0);
}

async function getSiblingLinkMeta(db: D1Database, aId: string, bId: string) {
  const { results } = await db.prepare(
    'SELECT id, dob FROM people WHERE id IN (?, ?)'
  ).bind(aId, bId).all();

  const a = results.find(p => p.id === aId) as any | undefined;
  const b = results.find(p => p.id === bId) as any | undefined;
  const aDob = a?.dob ? new Date(a.dob).getTime() : 0;
  const bDob = b?.dob ? new Date(b.dob).getTime() : 0;

  if (aDob && bDob && aDob !== bDob) {
    const olderId = aDob < bDob ? aId : bId;
    const youngerId = olderId === aId ? bId : aId;
    return {
      fromId: olderId,
      toId: youngerId,
      metadata: JSON.stringify({ sourceHandle: 'right-s', targetHandle: 'left-t' })
    };
  }

  return {
    fromId: aId,
    toId: bId,
    metadata: JSON.stringify({ sourceHandle: 'left-s', targetHandle: 'right-t' })
  };
}

// ============================================================================
// PEOPLE ENDPOINTS
// ============================================================================

// Get all people
app.get('/api/people', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people ORDER BY created_at'
  ).all();
  
  const parsedResults = results.map(person => ({
    ...person,
    metadata: safeParse(person.metadata as string)
  }));
  
  return c.json(parsedResults);
});

// Get a single person by ID
app.get('/api/people/:id', async (c) => {
  const person = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people WHERE id = ?'
  ).bind(id).first();

  if (!person) {
    return c.json({ error: 'Person not found' }, 404);
  }
  return c.json(person);
});

// Create a new person
app.post('/api/people', async (c) => {
  const body = await c.req.json();
  const { id: providedId, name, gender, dob, dod, tob, tod, avatar_url, metadata } = body;

  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }

  const id = providedId || crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO people (id, name, gender, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id,
    name,
    gender || 'O',
    dob || null,
    dod || null,
    tob || null,
    tod || null,
    avatar_url || null,
    metadata ? JSON.stringify(metadata) : null,
    now,
    now
  ).run();

  const person = await c.env.DB.prepare(
    'SELECT id, name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people WHERE id = ?'
  ).bind(id).first();

  return c.json(person, 201);
});

// Update a person
app.put('/api/people/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name, gender, dob, dod, tob, tod, avatar_url, metadata } = body;

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
  if (dod !== undefined) {
    updates.push('dod = ?');
    values.push(dod);
  }
  if (tob !== undefined) {
    updates.push('tob = ?');
    values.push(tob);
  }
  if (tod !== undefined) {
    updates.push('tod = ?');
    values.push(tod);
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
    'SELECT id, name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people WHERE id = ?'
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
  const { from_person_id, to_person_id, type, metadata, skipAutoLink, skip_auto_link } = body;
  const shouldSkipAutoLink = Boolean(skipAutoLink ?? skip_auto_link);

  if (!from_person_id || !to_person_id || !type) {
    return c.json({ error: 'from_person_id, to_person_id, and type are required' }, 400);
  }

  if (!['parent_child', 'spouse', 'sibling', 'in_law'].includes(type)) {
    return c.json({ error: 'type must be parent_child, spouse, sibling, or in_law' }, 400);
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

  let relationshipType = type;

  if (type === 'parent_child') {
    const spouseOfFrom = await c.env.DB.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(from_person_id, from_person_id).all();
    const spouseOfTo = await c.env.DB.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(to_person_id, to_person_id).all();

    const spouseIdsFrom = spouseOfFrom.results.map(rel =>
      rel.from_person_id === from_person_id ? rel.to_person_id : rel.from_person_id
    );
    const spouseIdsTo = spouseOfTo.results.map(rel =>
      rel.from_person_id === to_person_id ? rel.to_person_id : rel.from_person_id
    );

    for (const spouseId of spouseIdsTo) {
      const isChild = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
      ).bind(from_person_id, spouseId).first();
      if (isChild) {
        relationshipType = 'in_law';
        break;
      }
    }

    if (relationshipType === 'parent_child') {
      for (const spouseId of spouseIdsFrom) {
        const isChild = await c.env.DB.prepare(
          "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
        ).bind(to_person_id, spouseId).first();
        if (isChild) {
          relationshipType = 'in_law';
          break;
        }
      }
    }
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(from_person_id, to_person_id, relationshipType, metadata ? JSON.stringify(metadata) : null, now).run();

  // --- AUTO LINKING LOGIC ---
  if (!shouldSkipAutoLink && relationshipType === 'parent_child') {
    // Edge: Parent (from) -> Child (to)
    // 1. If Parent has a spouse, link Spouse -> Child
    const { results: spouses } = await c.env.DB.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(from_person_id, from_person_id).all();
    
    for (const rel of spouses) {
      const spouseId = rel.from_person_id === from_person_id ? rel.to_person_id : rel.from_person_id;
      // Check if link exists
      const exists = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
      ).bind(spouseId, to_person_id).first();
      
      if (!exists) {
         // Auto-link: Spouse -> Child
         // Metadata: Bottom -> Top
         const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
         await c.env.DB.prepare(
           "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)"
         ).bind(spouseId, to_person_id, meta, now).run();
      }
    }

    // 2. Link Child with existing siblings (other children of the same parent)
    const { results: siblings } = await c.env.DB.prepare(
      "SELECT to_person_id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id != ?"
    ).bind(from_person_id, to_person_id).all();

    for (const s of siblings) {
      const siblingId = s.to_person_id as string;
      const exists = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'sibling' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
      ).bind(to_person_id, siblingId, siblingId, to_person_id).first();

      if (!exists) {
        const link = await getSiblingLinkMeta(c.env.DB, to_person_id, siblingId);
        await c.env.DB.prepare(
          "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'sibling', ?, ?)"
        ).bind(link.fromId, link.toId, link.metadata, now).run();
      }
    }
  }

  if (!shouldSkipAutoLink && relationshipType === 'sibling') {
    // Edge: A <-> B (siblings)
    // 1. Find A's parents. Link them to B.
    const { results: parentsA } = await c.env.DB.prepare(
       "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
    ).bind(from_person_id).all();
    
    for (const p of parentsA) {
       const parentId = p.from_person_id;
       const exists = await c.env.DB.prepare("SELECT id FROM relationships WHERE type='parent_child' AND from_person_id=? AND to_person_id=?").bind(parentId, to_person_id).first();
       if (!exists) {
          const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
          await c.env.DB.prepare("INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)").bind(parentId, to_person_id, meta, now).run();
       }
    }

    // 2. Find B's parents. Link them to A.
    const { results: parentsB } = await c.env.DB.prepare(
       "SELECT from_person_id FROM relationships WHERE type = 'parent_child' AND to_person_id = ?"
    ).bind(to_person_id).all();
    
    for (const p of parentsB) {
       const parentId = p.from_person_id;
       const exists = await c.env.DB.prepare("SELECT id FROM relationships WHERE type='parent_child' AND from_person_id=? AND to_person_id=?").bind(parentId, from_person_id).first();
       if (!exists) {
          const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
          await c.env.DB.prepare("INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)").bind(parentId, from_person_id, meta, now).run();
       }
    }
  }

  if (!shouldSkipAutoLink && relationshipType === 'spouse') {
      // Edge: A <-> B (Spouse)
      // 1. A's children become B's children
      const { results: childrenA } = await c.env.DB.prepare("SELECT to_person_id FROM relationships WHERE type='parent_child' AND from_person_id=?").bind(from_person_id).all();
      for (const c of childrenA) {
         const childId = c.to_person_id;
         const exists = await c.env.DB.prepare("SELECT id FROM relationships WHERE type='parent_child' AND from_person_id=? AND to_person_id=?").bind(to_person_id, childId).first();
         if (!exists) {
            const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
            await c.env.DB.prepare("INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)").bind(to_person_id, childId, meta, now).run();
         }
      }
      
      // 2. B's children become A's children
      const { results: childrenB } = await c.env.DB.prepare("SELECT to_person_id FROM relationships WHERE type='parent_child' AND from_person_id=?").bind(to_person_id).all();
      for (const c of childrenB) {
         const childId = c.to_person_id;
         const exists = await c.env.DB.prepare("SELECT id FROM relationships WHERE type='parent_child' AND from_person_id=? AND to_person_id=?").bind(from_person_id, childId).first();
         if (!exists) {
            const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
            await c.env.DB.prepare("INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'parent_child', ?, ?)").bind(from_person_id, childId, meta, now).run();
         }
      }

      // 3. Link parents to spouse as in-law
      const primaryCount = await linkParentsToInLaw(c.env.DB, from_person_id, to_person_id, now);
      if (primaryCount === 0) {
        await linkParentsToInLaw(c.env.DB, to_person_id, from_person_id, now);
      } else {
        const parentsOverlap = await shareParents(c.env.DB, from_person_id, to_person_id);
        if (!parentsOverlap) {
          await linkParentsToInLaw(c.env.DB, to_person_id, from_person_id, now);
        }
      }
  }
  if (!shouldSkipAutoLink && relationshipType === 'in_law') {
    // Edge: A <-> B (in-law)
    // If A is connected to B as in-law, mirror to the other parent (A's spouse or B's spouse).
    const { results: spousesOfTo } = await c.env.DB.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(to_person_id, to_person_id).all();
    const { results: spousesOfFrom } = await c.env.DB.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(from_person_id, from_person_id).all();

    let parentId: string | null = null;
    let inLawId: string | null = null;

    for (const rel of spousesOfTo) {
      const spouseId = rel.from_person_id === to_person_id ? rel.to_person_id : rel.from_person_id;
      const isChild = await c.env.DB.prepare(
        "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
      ).bind(from_person_id, spouseId).first();
      if (isChild) {
        parentId = from_person_id;
        inLawId = to_person_id;
        break;
      }
    }

    if (!parentId || !inLawId) {
      for (const rel of spousesOfFrom) {
        const spouseId = rel.from_person_id === from_person_id ? rel.to_person_id : rel.from_person_id;
        const isChild = await c.env.DB.prepare(
          "SELECT id FROM relationships WHERE type = 'parent_child' AND from_person_id = ? AND to_person_id = ?"
        ).bind(to_person_id, spouseId).first();
        if (isChild) {
          parentId = to_person_id;
          inLawId = from_person_id;
          break;
        }
      }
    }

    if (parentId && inLawId) {
      const { results: parentSpouses } = await c.env.DB.prepare(
        "SELECT from_person_id, to_person_id FROM relationships WHERE type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
      ).bind(parentId, parentId).all();

      for (const rel of parentSpouses) {
        const spouseId = rel.from_person_id === parentId ? rel.to_person_id : rel.from_person_id;
        const exists = await c.env.DB.prepare(
          "SELECT id FROM relationships WHERE type = 'in_law' AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
        ).bind(inLawId, spouseId, spouseId, inLawId).first();

        if (!exists) {
          const meta = JSON.stringify({ sourceHandle: 'bottom-s', targetHandle: 'top-t' });
          await c.env.DB.prepare(
            "INSERT INTO relationships (from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, 'in_law', ?, ?)"
          ).bind(spouseId, inLawId, meta, now).run();
        }
      }
    }
  }
  // --- END AUTO LINKING ---

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
    const { type, metadata, from_person_id, to_person_id } = body;

    console.log(`PUT /api/relationships/${id}`, body);

    const existing = await c.env.DB.prepare(
      'SELECT id, from_person_id, to_person_id, type FROM relationships WHERE id = ?'
    ).bind(id).first();

    if (!existing) {
      return c.json({ error: 'Relationship not found' }, 404);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (from_person_id !== undefined) {
      updates.push('from_person_id = ?');
      values.push(from_person_id);
    }

    if (to_person_id !== undefined) {
      updates.push('to_person_id = ?');
      values.push(to_person_id);
    }

    if (type !== undefined) {
      if (!['parent_child', 'spouse', 'sibling', 'in_law'].includes(type)) {
        return c.json({ error: 'type must be parent_child, spouse, sibling, or in_law' }, 400);
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

    const nextType = type ?? (existing as any).type;
    const nextFromId = from_person_id ?? (existing as any).from_person_id;
    const nextToId = to_person_id ?? (existing as any).to_person_id;

    if (nextType === 'spouse') {
      const now = new Date().toISOString();
      const { results: people } = await c.env.DB.prepare(
        'SELECT id, name, gender FROM people WHERE id IN (?, ?)'
      ).bind(nextFromId, nextToId).all();

      const fromPerson = people.find(p => p.id === nextFromId) as any | undefined;
      const toPerson = people.find(p => p.id === nextToId) as any | undefined;

      const fromSurname = getSurname(fromPerson?.name);
      const toSurname = getSurname(toPerson?.name);

      let familySurname = '';
      if (fromPerson?.gender === 'M') familySurname = fromSurname;
      else if (toPerson?.gender === 'M') familySurname = toSurname;
      else familySurname = fromSurname || toSurname;

      let childId = nextFromId;
      let inLawId = nextToId;
      if (familySurname) {
        const fromMatches = fromSurname === familySurname;
        const toMatches = toSurname === familySurname;
        if (fromMatches && !toMatches) {
          childId = nextFromId;
          inLawId = nextToId;
        } else if (toMatches && !fromMatches) {
          childId = nextToId;
          inLawId = nextFromId;
        } else if (fromPerson?.gender === 'M') {
          childId = nextFromId;
          inLawId = nextToId;
        } else if (toPerson?.gender === 'M') {
          childId = nextToId;
          inLawId = nextFromId;
        }
      }

      const primaryCount = await linkParentsToInLaw(c.env.DB, childId, inLawId, now);
      if (primaryCount === 0) {
        await linkParentsToInLaw(c.env.DB, inLawId, childId, now);
      } else {
        const parentsOverlap = await shareParents(c.env.DB, childId, inLawId);
        if (!parentsOverlap) {
          await linkParentsToInLaw(c.env.DB, inLawId, childId, now);
        }
      }
    }

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
      'SELECT id, name, gender, dob, dod, tob, tod FROM people WHERE id = ?'
    ).bind(centerId).first();

    if (!center) {
      console.log('Center person not found');
      return c.json({ error: 'Center person not found' }, 404);
    }

    // Get all people
    console.log('Fetching all people...');
    const { results: peopleRaw } = await c.env.DB.prepare(
      'SELECT id, name, gender, dob, dod, tob, tod, avatar_url, metadata FROM people'
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
        if (person.id === centerId) {
          return { ...person, title: '我' };
        }
        const { title } = calculateKinship(centerId, person.id, relationships, people, center as any);
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
function calculateKinship(
  centerId: string,
  targetId: string,
  relationships: Relationship[],
  people: Person[],
  centerPerson: Person
): { title: string } {
  const parentMap = new Map<string, string[]>();
  relationships.forEach(r => {
    if (r.type === 'parent_child') {
      if (!parentMap.has(r.to_person_id)) parentMap.set(r.to_person_id, []);
      parentMap.get(r.to_person_id)?.push(r.from_person_id);
    }
  });

  // Prefer direct ancestor chain (parent-child only) to avoid in-law mislabeling.
  const queueAnc: Array<{ id: string; path: string[]; nodePath: string[] }> = [{
    id: centerId,
    path: [],
    nodePath: [centerId]
  }];
  const visitedAnc = new Set<string>([centerId]);

  while (queueAnc.length > 0) {
    const current = queueAnc.shift()!;
    if (current.id === targetId && current.path.length > 0) {
      return { title: pathToTitle(current.path, current.nodePath, centerPerson, people, targetId, relationships) };
    }
    const parents = parentMap.get(current.id) || [];
    for (const parentId of parents) {
      if (!visitedAnc.has(parentId)) {
        visitedAnc.add(parentId);
        queueAnc.push({
          id: parentId,
          path: [...current.path, 'up'],
          nodePath: [...current.nodePath, parentId]
        });
      }
    }
  }

  // Build adjacency list for graph traversal
  const adj = new Map<string, Array<{ id: string; type: string; direction: 'up' | 'down' | 'spouse' | 'sibling' | 'inlaw' }>>();

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
      } else if (r.type === 'sibling') {
        fromNode.push({ id: r.to_person_id, type: 'sibling', direction: 'sibling' });
        toNode.push({ id: r.from_person_id, type: 'sibling', direction: 'sibling' });
      } else if (r.type === 'in_law') {
        fromNode.push({ id: r.to_person_id, type: 'in_law', direction: 'inlaw' });
        toNode.push({ id: r.from_person_id, type: 'in_law', direction: 'inlaw' });
      }
    }
  }

  // BFS to find shortest path, then prefer fewer in-law hops among shortest paths.
  // queue item: { id, path: directions[], nodePath: nodeIds[] }
  const queue: Array<{ id: string; path: string[]; nodePath: string[] }> = [{
    id: centerId,
    path: [],
    nodePath: [centerId]
  }];
  const visited = new Set<string>([centerId]);
  let foundDepth: number | null = null;
  let bestPath: { path: string[]; nodePath: string[] } | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.id === targetId) {
      if (foundDepth === null) {
        foundDepth = current.path.length;
        bestPath = { path: current.path, nodePath: current.nodePath };
      } else if (current.path.length === foundDepth) {
        const currentInlawCount = current.path.filter(p => p === 'inlaw').length;
        const bestInlawCount = bestPath
          ? bestPath.path.filter(p => p === 'inlaw').length
          : Number.POSITIVE_INFINITY;
        if (currentInlawCount < bestInlawCount) {
          bestPath = { path: current.path, nodePath: current.nodePath };
        }
      }
      continue;
    }

    if (foundDepth !== null && current.path.length >= foundDepth) {
      continue;
    }

    const neighbors = adj.get(current.id) || [];
    const sorted = [
      ...neighbors.filter(n => n.direction !== 'inlaw'),
      ...neighbors.filter(n => n.direction === 'inlaw')
    ];
    for (const neighbor of sorted) {
      const canRevisitTarget =
        neighbor.id === targetId && (foundDepth === null || current.path.length + 1 <= foundDepth);
      if (!visited.has(neighbor.id) || canRevisitTarget) {
        visited.add(neighbor.id);
        queue.push({
          id: neighbor.id,
          path: [...current.path, neighbor.direction],
          nodePath: [...current.nodePath, neighbor.id]
        });
      }
    }
  }

  if (bestPath) {
    return {
      title: pathToTitle(bestPath.path, bestPath.nodePath, centerPerson, people, targetId, relationships)
    };
  }

  return { title: '未知' };
}

// Convert path (array of directions) to Chinese kinship title
function pathToTitle(
  path: string[],
  nodePath: string[],
  centerPerson: Person,
  people: Person[],
  targetId: string,
  relationships: Relationship[]
): string {
  const target = people.find(p => p.id === targetId);
  if (!target) return '未知';

  // Helper to get person by ID
  const getPerson = (id: string) => people.find(p => p.id === id);
  const getSiblingRank = (sibling: Person) => {
    const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
    const siblingDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!centerDob || !siblingDob) return null;

    if (siblingDob >= centerDob) {
      return { relation: 'younger', rank: 0 };
    }

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === centerPerson.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === centerPerson.id) siblingIds.add(r.from_person_id);
      }
    });

    const parentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === centerPerson.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && parentIds.includes(r.from_person_id) && r.to_person_id !== centerPerson.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getGrandparentSiblingRank = (grandparent: Person, sibling: Person) => {
    const gpDob = grandparent.dob ? new Date(grandparent.dob).getTime() : 0;
    const sibDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!gpDob || !sibDob) return null;
    if (sibDob >= gpDob) return { relation: 'younger', rank: 0 };

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === grandparent.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === grandparent.id) siblingIds.add(r.from_person_id);
      }
    });

    const parentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === grandparent.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && parentIds.includes(r.from_person_id) && r.to_person_id !== grandparent.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getParentSiblingRank = (parent: Person, sibling: Person) => {
    const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
    const sibDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!parentDob || !sibDob) return null;
    if (sibDob >= parentDob) return { relation: 'younger', rank: 0 };

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === parent.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === parent.id) siblingIds.add(r.from_person_id);
      }
    });

    const grandparentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === parent.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && grandparentIds.includes(r.from_person_id) && r.to_person_id !== parent.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getParentSiblingSpouseTitle = (parent: Person, auntUncle: Person) => {
    if (parent.gender === 'M') {
      if (auntUncle.gender === 'M') {
        const rank = getParentSiblingRank(parent, auntUncle);
        if (rank?.relation === 'older') {
          if (rank.rank === 1) return '大伯母';
          if (rank.rank === 2) return '二伯母';
          if (rank.rank === 3) return '三伯母';
          if (rank.rank === 4) return '四伯母';
          if (rank.rank === 5) return '五伯母';
          if (rank.rank === 6) return '六伯母';
          if (rank.rank === 7) return '七伯母';
          if (rank.rank === 8) return '八伯母';
          if (rank.rank === 9) return '九伯母';
          if (rank.rank === 10) return '十伯母';
          return `第${rank.rank}伯母`;
        }
        return '嬸嬸';
      }
      return '姑丈';
    }
    if (parent.gender === 'F') {
      if (auntUncle.gender === 'M') {
        return '舅媽';
      }
      return '姨丈';
    }
    return null;
  };

  const pathStr = path.join('-');

  // Self
  if (path.length === 0) return '我';

  const isSpouseOfChild = (parentId: string, personId: string) => {
    const childIds = relationships
      .filter(r => r.type === 'parent_child' && r.from_person_id === parentId)
      .map(r => r.to_person_id);
    for (const childId of childIds) {
      const isSpouse = relationships.some(r =>
        r.type === 'spouse' &&
        ((r.from_person_id === childId && r.to_person_id === personId) ||
         (r.to_person_id === childId && r.from_person_id === personId))
      );
      if (isSpouse) return true;
    }
    return false;
  };

  // Direct relationships
  if (pathStr === 'up' || pathStr === 'sibling-up') return target.gender === 'M' ? '父親' : '母親';
  if (pathStr === 'down') return target.gender === 'M' ? '兒子' : '女兒';
  if (pathStr === 'spouse') return centerPerson.gender === 'M' ? '妻子' : '丈夫';
  if (pathStr === 'inlaw') {
    if (isSpouseOfChild(centerPerson.id, targetId)) {
      return target.gender === 'M' ? '女婿' : '媳婦';
    }
    if (isSpouseOfChild(targetId, centerPerson.id)) {
      return target.gender === 'M' ? '岳父/公公' : '岳母/婆婆';
    }
    return '姻親';
  }

  // Siblings (up -> down OR explicit sibling)
  if (pathStr === 'up-down' || pathStr === 'sibling') {
    const rank = getSiblingRank(target);
    if (!rank) return target.gender === 'M' ? '兄弟' : '姊妹';
    if (rank.relation === 'older') {
      const suffix = target.gender === 'M' ? '哥' : '姊';
      if (rank.rank === 1) return `大${suffix}`;
      if (rank.rank === 2) return `二${suffix}`;
      if (rank.rank === 3) return `三${suffix}`;
      if (rank.rank === 4) return `四${suffix}`;
      if (rank.rank === 5) return `五${suffix}`;
      if (rank.rank === 6) return `六${suffix}`;
      if (rank.rank === 7) return `七${suffix}`;
      if (rank.rank === 8) return `八${suffix}`;
      if (rank.rank === 9) return `九${suffix}`;
      if (rank.rank === 10) return `十${suffix}`;
      return `第${rank.rank}${suffix}`;
    }
    return target.gender === 'M' ? '弟弟' : '妹妹';
  }

  // Grandparents (up -> up)
  if (pathStr === 'up-up') {
    const parent = getPerson(nodePath[1]);
    if (parent) {
      if (parent.gender === 'M') { // Father's parents
        return target.gender === 'M' ? '祖父/爺爺' : '祖母/奶奶';
      } else { // Mother's parents
        return target.gender === 'M' ? '外祖父/外公' : '外祖母/外婆';
      }
    }
    // Fallback if parent not found or ambiguous
    if (target.gender === 'M') return '祖父/外祖父';
    return '祖母/外祖母';
  }

  // Great-grandparents and beyond (all ups)
  if (path.length >= 3 && path.every(p => p === 'up')) {
    const ancestorDepth = path.length; // 3 = 曾祖, 4 = 高祖, 5 = 曾高祖, 6 = 玄祖, 7 = 曾玄祖, 8 = 來祖
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    const baseNames = [
      '',
      '',
      '',
      '曾祖',
      '高祖',
      '曾高祖',
      '玄祖',
      '曾玄祖',
      '來祖'
    ];
    const base = baseNames[ancestorDepth] || `第${ancestorDepth - 1}代祖`;
    const prefix = isMaternal ? '外' : '';
    return `${prefix}${base}${target.gender === 'M' ? '父' : '母'}`;
  }

  // Uncles/Aunts (Parent's Sibling)
  // Path can be: up-sibling (explicit) OR up-up-down (via grandparent)
  if (pathStr === 'up-sibling' || pathStr === 'up-up-down') {
    // nodePath[1] is the Parent
    const parent = getPerson(nodePath[1]);
    
    if (parent) {
      if (parent.gender === 'M') { // Father's side
        if (target.gender === 'M') {
          // Father's Brother: Check age relative to Father (parent)
          const rank = getParentSiblingRank(parent, target);
          if (rank?.relation === 'older') {
            if (rank.rank === 1) return '大伯';
            if (rank.rank === 2) return '二伯';
            if (rank.rank === 3) return '三伯';
            if (rank.rank === 4) return '四伯';
            if (rank.rank === 5) return '五伯';
            if (rank.rank === 6) return '六伯';
            if (rank.rank === 7) return '七伯';
            if (rank.rank === 8) return '八伯';
            if (rank.rank === 9) return '九伯';
            if (rank.rank === 10) return '十伯';
            return `第${rank.rank}伯`;
          }
          return '叔叔';
        } else {
          // Father's Sister
          return '姑姑';
        }
      } else { // Mother's side
        if (target.gender === 'M') {
          return '舅舅';
        } else {
          return '阿姨';
        }
      }
    }
  }

  // Uncle/Aunt's spouse (伯母/嬸嬸/姑丈/舅媽/姨丈)
  if (pathStr === 'up-sibling-spouse' || pathStr === 'up-up-down-spouse') {
    const parent = getPerson(nodePath[1]);
    const auntUncle = getPerson(nodePath[2]);
    if (parent && auntUncle) {
      const title = getParentSiblingSpouseTitle(parent, auntUncle);
      if (title) return title;
    }
  }

  // Grandparent's in-law (伯母/嬸嬸/姑丈/舅媽/姨丈) via in_law link
  if (pathStr === 'up-up-inlaw') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const spouseChildId = relationships.find(r =>
      r.type === 'spouse' &&
      ((r.from_person_id === targetId && relationships.some(rel => rel.type === 'parent_child' && rel.from_person_id === grandparent?.id && rel.to_person_id === r.to_person_id)) ||
       (r.to_person_id === targetId && relationships.some(rel => rel.type === 'parent_child' && rel.from_person_id === grandparent?.id && rel.to_person_id === r.from_person_id)))
    );
    const spouseChild = spouseChildId
      ? getPerson(spouseChildId.from_person_id === targetId ? spouseChildId.to_person_id : spouseChildId.from_person_id)
      : undefined;

    if (parent && spouseChild) {
      if (parent.gender === 'M') {
        if (spouseChild.gender === 'M') {
          const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
          const uncleDob = spouseChild.dob ? new Date(spouseChild.dob).getTime() : 0;
          if (parentDob && uncleDob) {
            return uncleDob < parentDob ? '伯母' : '嬸嬸';
          }
          return '伯母/嬸嬸';
        }
        return '姑丈';
      }
      if (parent.gender === 'F') {
        if (spouseChild.gender === 'M') return '舅媽';
        return '姨丈';
      }
    }
  }

  // Grand-Uncles/Aunts (Grandparent's Sibling)
  // Path: up-up-sibling OR up-up-up-down
  if (pathStr === 'up-up-sibling' || pathStr === 'up-up-up-down') {
    // nodePath[2] is the Grandparent
    // nodePath[1] is the Parent (determines 'Outer' for some dialects, but usually purely based on Grandparent's gender)
    const grandparent = getPerson(nodePath[2]);
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F'; // Mother's side

    if (grandparent) {
      if (grandparent.gender === 'M') { // Via Grandfather
        if (target.gender === 'M') {
          const rank = getGrandparentSiblingRank(grandparent, target);
          const title = rank?.relation === 'older' ? '伯公' : '叔公';
          if (rank?.relation === 'older') {
            if (rank.rank === 1) return isMaternal ? '外大伯公' : '大伯公';
            if (rank.rank === 2) return isMaternal ? '外二伯公' : '二伯公';
            if (rank.rank === 3) return isMaternal ? '外三伯公' : '三伯公';
          }
          return isMaternal ? `外${title}` : title;
        }
        const title = '姑婆';
        return isMaternal ? `外${title}` : title;
      }
      if (target.gender === 'M') {
        return '舅公';
      }
      return '姨婆';
    }
  }

  // Grand-Uncles/Aunts' spouse
  if (pathStr === 'up-up-sibling-spouse' || pathStr === 'up-up-up-down-spouse') {
    const grandparent = getPerson(nodePath[2]);
    const auntUncle = getPerson(nodePath[3]);
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    if (grandparent && auntUncle) {
      if (grandparent.gender === 'M') {
        if (auntUncle.gender === 'M') {
          const rank = getGrandparentSiblingRank(grandparent, auntUncle);
          const base = rank?.relation === 'older' ? '伯婆' : '嬸婆';
          return isMaternal ? `外${base}` : base;
        }
        const base = '姑丈公';
        return isMaternal ? `外${base}` : base;
      }
      if (auntUncle.gender === 'M') {
        return '舅媽';
      }
      return '姨丈';
    }
  }

  // Parent's in-law's sibling (父/母的姻親的手足)
  if (pathStr === 'up-inlaw-sibling' || pathStr === 'up-spouse-up-down' || pathStr === 'up-spouse-sibling') {
    const parent = getPerson(nodePath[1]);
    if (parent) {
      if (parent.gender === 'M') {
        // Father's in-law side -> maternal grandparent's siblings
        return target.gender === 'M' ? '舅公' : '姨婆';
      }
      if (parent.gender === 'F') {
        // Mother's in-law side -> paternal grandparent's siblings
        return target.gender === 'M' ? '伯公/叔公' : '姑婆';
      }
    }
  }

  // Nephews/Nieces and their descendants (Sibling's line)
  // Path: sibling -> down... OR up -> down -> down...
  if (pathStr.startsWith('sibling-down') || pathStr.startsWith('up-down-down')) {
    let sibling: Person | undefined;
    let downCount = 0;
    if (path[0] === 'sibling') {
      sibling = getPerson(nodePath[1]);
      downCount = path.slice(1).filter(p => p === 'down').length;
    } else if (path[0] === 'up' && path[1] === 'down') {
      sibling = getPerson(nodePath[2]);
      downCount = path.slice(2).filter(p => p === 'down').length;
    }

    if (sibling && downCount >= 1) {
      const isBrotherLine = sibling.gender === 'M';
      if (downCount === 1) {
        return isBrotherLine
          ? (target.gender === 'M' ? '姪子' : '姪女')
          : (target.gender === 'M' ? '外甥' : '外甥女');
      }

      const prefixMap = ['', '', '', '曾', '玄', '來', '第六代', '第七代', '第八代'];
      const prefix = prefixMap[downCount] || `第${downCount}代`;
      const base = isBrotherLine ? '姪孫' : '外甥孫';
      const suffix = target.gender === 'M' ? '' : '女';
      return `${prefix}${base}${suffix}`;
    }
  }

  // Grandchildren
  if (pathStr === 'down-down') {
    // Check intermediate child to distinguish Grandson (son's son) vs Outer Grandson (daughter's son)
    const child = getPerson(nodePath[1]);
    if (child) {
      if (child.gender === 'M') {
        return target.gender === 'M' ? '孫子' : '孫女';
      } else {
        return target.gender === 'M' ? '外孫' : '外孫女';
      }
    }
    if (target.gender === 'M') return '孫子/外孫';
    return '孫女/外孫女';
  }

  // Great-grandchildren and beyond (direct descendants)
  if (pathStr === 'down-down-down') {
    return target.gender === 'M' ? '曾孫' : '曾孫女';
  }
  if (pathStr === 'down-down-down-down') {
    return target.gender === 'M' ? '玄孫' : '玄孫女';
  }
  if (pathStr === 'down-down-down-down-down') {
    return target.gender === 'M' ? '來孫' : '來孫女';
  }

  // Child-in-law (down -> spouse)
  if (pathStr === 'down-spouse') {
    return target.gender === 'M' ? '女婿' : '媳婦';
  }

  // Sibling-in-law (up -> down -> spouse)
  if (pathStr === 'up-down-spouse' || pathStr === 'sibling-spouse') {
    let sibling: Person | undefined;
    if (pathStr === 'sibling-spouse') {
      sibling = getPerson(nodePath[1]);
    } else {
      sibling = getPerson(nodePath[2]);
    }

    if (sibling?.gender === 'M') {
      const rank = getSiblingRank(sibling);
      if (rank?.relation === 'older') {
        if (rank.rank === 1) return '大嫂';
        if (rank.rank === 2) return '二嫂';
        if (rank.rank === 3) return '三嫂';
        if (rank.rank === 4) return '四嫂';
        if (rank.rank === 5) return '五嫂';
        if (rank.rank === 6) return '六嫂';
        if (rank.rank === 7) return '七嫂';
        if (rank.rank === 8) return '八嫂';
        if (rank.rank === 9) return '九嫂';
        if (rank.rank === 10) return '十嫂';
        return `第${rank.rank}嫂`;
      }
      return '弟媳';
    }
    if (sibling?.gender === 'F') {
      const rank = getSiblingRank(sibling);
      if (rank?.relation === 'older') {
        if (rank.rank === 1) return '大姐夫';
        if (rank.rank === 2) return '二姐夫';
        if (rank.rank === 3) return '三姐夫';
        if (rank.rank === 4) return '四姐夫';
        if (rank.rank === 5) return '五姐夫';
        if (rank.rank === 6) return '六姐夫';
        if (rank.rank === 7) return '七姐夫';
        if (rank.rank === 8) return '八姐夫';
        if (rank.rank === 9) return '九姐夫';
        if (rank.rank === 10) return '十姐夫';
        return `第${rank.rank}姐夫`;
      }
      return '妹夫';
    }
    if (target.gender === 'M') return '姊夫/妹夫';
    return '嫂嫂/弟媳';
  }

  if (pathStr === 'up-inlaw') {
    if (target.gender === 'M') return '姊夫/妹夫';
    return '嫂嫂/弟媳';
  }

  // Parent's sibling's spouse via in-law chain
  if (pathStr === 'up-inlaw-inlaw') {
    const parent = getPerson(nodePath[1]);
    const possibleSibling = getPerson(nodePath[2]);
    const possibleSpouse = getPerson(nodePath[3]);
    if (parent && possibleSibling && possibleSpouse) {
      const parentIds = relationships
        .filter(r => r.type === 'parent_child' && r.to_person_id === parent.id)
        .map(r => r.from_person_id);
      const siblingParentIds = relationships
        .filter(r => r.type === 'parent_child' && r.to_person_id === possibleSibling.id)
        .map(r => r.from_person_id);
      const sharesParent = parentIds.some(id => siblingParentIds.includes(id));
      const isSpouse = relationships.some(r =>
        r.type === 'spouse' &&
        ((r.from_person_id === possibleSibling.id && r.to_person_id === possibleSpouse.id) ||
         (r.to_person_id === possibleSibling.id && r.from_person_id === possibleSpouse.id))
      );

      if (sharesParent && isSpouse) {
        const title = getParentSiblingSpouseTitle(parent, possibleSibling);
        if (title) return title;
      }
    }
  }

  if (pathStr === 'down-inlaw') {
    return target.gender === 'M' ? '女婿' : '媳婦';
  }
  
  // Spouse's sibling (spouse -> up -> down) OR spouse -> sibling
  if (pathStr === 'spouse-up-down' || pathStr === 'spouse-sibling') {
    if (target.gender === 'M') return '大伯/小叔/內兄/內弟';
    return '大姑/小姑/姨姐/姨妹';
  }

  // Spouse's sibling's child
  if (pathStr === 'spouse-sibling-down' || pathStr === 'spouse-up-down-down') {
    if (target.gender === 'M') return '姪子/外甥(姻)';
    return '姪女/外甥女(姻)';
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

  // Cousins (parent's sibling's child: up-up-down-down or up-sibling-down)
  if (pathStr === 'up-up-down-down' || pathStr === 'up-sibling-down') {
     const parent = getPerson(nodePath[1]);
     const auntUncle = pathStr === 'up-sibling-down' ? getPerson(nodePath[2]) : getPerson(nodePath[2]);
     const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
     const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
     const isOlder = centerDob && targetDob ? targetDob < centerDob : null;
     const genderLabel = target.gender === 'M'
       ? (isOlder === false ? '弟' : '兄')
       : (isOlder === false ? '妹' : '姊');

     if (parent && auntUncle) {
       const isFather = parent.gender === 'M';
       const isPaternalBrother = isFather && auntUncle.gender === 'M';
       if (isPaternalBrother) {
         return isOlder === null
           ? (target.gender === 'M' ? '堂兄弟' : '堂姊妹')
           : `堂${genderLabel}`;
       }
       return isOlder === null
         ? (target.gender === 'M' ? '表兄弟' : '表姊妹')
         : `表${genderLabel}`;
     }

     return '堂/表兄弟姊妹';
  }

  // Sibling's Spouse's Sibling (Sister-in-law/Brother-in-law's sibling)
  if (pathStr === 'up-down-spouse-sibling' || pathStr === 'sibling-spouse-sibling') {
    let linkingSibling: Person | undefined;
    if (pathStr === 'sibling-spouse-sibling') {
        linkingSibling = getPerson(nodePath[1]);
    } else {
        linkingSibling = getPerson(nodePath[2]);
    }

    if (linkingSibling) {
        const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
        const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
        
        if (target.gender === 'M') {
             if (centerDob && targetDob) {
                 return targetDob < centerDob ? '親家大哥' : '親家弟弟';
             }
             return '親家兄弟';
        } else {
             if (centerDob && targetDob) {
                 return targetDob < centerDob ? '親家大姊' : '親家妹妹';
             }
             return '親家姊妹';
        }
    }
  }

  // Default: show path for debugging in Chinese
  const chinesePath = path.map(p => {
    switch (p) {
      case 'up': return '父/母';
      case 'down': return '子/女';
      case 'spouse': return '配偶';
      case 'sibling': return '手足';
      case 'inlaw': return '姻親';
      default: return p;
    }
  }).join(' 的 ');
  return chinesePath;
}

export default app;
