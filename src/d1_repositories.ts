import type {
  BackupRepository,
  GraphRepository,
  GraphAvatarRow,
  PeopleRepository,
  RelationshipRepository,
  RepositoryMutationResult,
} from './repositories';
import type { Env, RelationshipType } from './types';
import { getUserSchemaSupport } from './schema';
import type {
  BackupAvatar,
  BackupCustomField,
  BackupKinshipLabel,
  BackupLayer,
  BackupPerson,
  BackupRelationship,
  BackupRelationshipTypeLabel,
} from './backup/service';

const toMutationResult = (result: D1Result): RepositoryMutationResult => ({
  lastRowId: typeof result.meta.last_row_id === 'number' ? result.meta.last_row_id : null,
  changes: Number(result.meta.changes ?? 0),
});

export class D1GraphRepository implements GraphRepository {
  constructor(private readonly env: Env) {}

  async getCenterPerson(layerId: string, centerId: string, includeEmail: boolean) {
    const row = await this.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod
       FROM people
       WHERE id = ? AND layer_id = ?`
    ).bind(centerId, layerId).first();
    return row as Record<string, unknown> | null;
  }

  async listPeople(layerId: string, includeEmail: boolean) {
    const { results } = await this.env.DB.prepare(
      `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
       FROM people
       WHERE layer_id = ?
       ORDER BY created_at`
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listRelationships(layerId: string) {
    const { results } = await this.env.DB.prepare(
      'SELECT * FROM relationships WHERE layer_id = ?'
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listCustomFieldRows(layerId: string) {
    const { results } = await this.env.DB.prepare(
      `SELECT cf.id, cf.person_id, cf.label, cf.value
       FROM person_custom_fields cf
       INNER JOIN people p ON p.id = cf.person_id
       WHERE p.layer_id = ?`
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listAvatarRows(layerId: string): Promise<GraphAvatarRow[]> {
    const { results } = await this.env.DB.prepare(
      `SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
       FROM person_avatars
       WHERE person_id IN (SELECT id FROM people WHERE layer_id = ?)
       ORDER BY person_id ASC, is_primary DESC, sort_order ASC, created_at ASC`
    ).bind(layerId).all();
    return (results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      person_id: String(row.person_id),
      avatar_url: String(row.avatar_url),
      storage_key: row.storage_key ? String(row.storage_key) : null,
      is_primary: Number(row.is_primary) === 1,
      sort_order: Number(row.sort_order ?? 0),
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    }));
  }

  async listVerifiedEmails(emails: Array<string | null | undefined>) {
    const userSchema = await getUserSchemaSupport(this.env.DB);
    if (!userSchema.hasEmail || !userSchema.hasEmailVerifiedAt) {
      return new Map<string, string>();
    }
    const normalizedEmails = Array.from(new Set(
      emails
        .map((email) => typeof email === 'string' ? email.trim().toLowerCase() : '')
        .filter(Boolean),
    ));
    if (!normalizedEmails.length) {
      return new Map<string, string>();
    }
    const placeholders = normalizedEmails.map(() => '?').join(', ');
    const { results } = await this.env.DB.prepare(
      `SELECT email, email_verified_at
       FROM users
       WHERE LOWER(TRIM(COALESCE(email, username))) IN (${placeholders})
         AND email_verified_at IS NOT NULL
         AND TRIM(email_verified_at) != ''`
    ).bind(...normalizedEmails).all();
    const map = new Map<string, string>();
    for (const row of results as Array<Record<string, unknown>>) {
      const email = String(row.email ?? '').trim().toLowerCase();
      const verifiedAt = String(row.email_verified_at ?? '').trim();
      if (email && verifiedAt) {
        map.set(email, verifiedAt);
      }
    }
    return map;
  }
}

export class D1RelationshipRepository implements RelationshipRepository {
  constructor(private readonly db: D1Database) {}

  async listRelationships(layerId: string) {
    const { results } = await this.db.prepare(
      'SELECT * FROM relationships WHERE layer_id = ? ORDER BY created_at'
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async getRelationshipById(id: string) {
    const row = await this.db.prepare(
      'SELECT * FROM relationships WHERE id = ?'
    ).bind(id).first();
    return row as Record<string, unknown> | null;
  }

  async personExists(layerId: string, personId: string) {
    const row = await this.db.prepare(
      'SELECT id FROM people WHERE layer_id = ? AND id = ?'
    ).bind(layerId, personId).first();
    return Boolean(row);
  }

  async findRelationship(
    layerId: string,
    type: RelationshipType,
    fromPersonId: string,
    toPersonId: string,
    bidirectional = false,
  ) {
    const row = bidirectional
      ? await this.db.prepare(
        "SELECT id FROM relationships WHERE layer_id = ? AND type = ? AND ((from_person_id = ? AND to_person_id = ?) OR (from_person_id = ? AND to_person_id = ?))"
      ).bind(
        layerId,
        type,
        fromPersonId,
        toPersonId,
        toPersonId,
        fromPersonId,
      ).first()
      : await this.db.prepare(
        "SELECT id FROM relationships WHERE layer_id = ? AND type = ? AND from_person_id = ? AND to_person_id = ?"
      ).bind(
        layerId,
        type,
        fromPersonId,
        toPersonId,
      ).first();
    return row as Record<string, unknown> | null;
  }

  async createRelationship(input: {
    layerId: string;
    fromPersonId: string;
    toPersonId: string;
    type: RelationshipType;
    metadata: string | null;
    createdAt: string;
  }) {
    const result = await this.db.prepare(
      'INSERT INTO relationships (layer_id, from_person_id, to_person_id, type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      input.layerId,
      input.fromPersonId,
      input.toPersonId,
      input.type,
      input.metadata,
      input.createdAt,
    ).run();
    return toMutationResult(result);
  }

  async updateRelationshipById(id: string, updates: Record<string, unknown>) {
    const entries = Object.entries(updates);
    if (!entries.length) {
      return { lastRowId: null, changes: 0 };
    }
    const columns = entries.map(([column]) => `${column} = ?`);
    const values = entries.map(([, value]) => value);
    const result = await this.db.prepare(
      `UPDATE relationships SET ${columns.join(', ')} WHERE id = ?`
    ).bind(...values, id).run();
    return toMutationResult(result);
  }

  async deleteRelationshipById(id: string) {
    const result = await this.db.prepare(
      'DELETE FROM relationships WHERE id = ?'
    ).bind(id).run();
    return toMutationResult(result);
  }

  async listPeopleByIds(layerId: string, personIds: string[]) {
    if (!personIds.length) return [];
    const placeholders = personIds.map(() => '?').join(', ');
    const { results } = await this.db.prepare(
      `SELECT id, name, dob FROM people WHERE layer_id = ? AND id IN (${placeholders})`
    ).bind(layerId, ...personIds).all();
    return results as Array<Record<string, unknown>>;
  }

  async listSiblingEdges(layerId: string, personId: string) {
    const { results } = await this.db.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE layer_id = ? AND type = 'sibling' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(layerId, personId, personId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listParentEdgesForChild(layerId: string, childId: string) {
    const { results } = await this.db.prepare(
      "SELECT from_person_id FROM relationships WHERE layer_id = ? AND type = 'parent_child' AND to_person_id = ?"
    ).bind(layerId, childId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listChildrenForParents(layerId: string, parentIds: string[], excludeChildId?: string) {
    if (!parentIds.length) return [];
    const placeholders = parentIds.map(() => '?').join(', ');
    const whereExclude = excludeChildId ? ' AND to_person_id != ?' : '';
    const bindValues = excludeChildId ? [layerId, ...parentIds, excludeChildId] : [layerId, ...parentIds];
    const { results } = await this.db.prepare(
      `SELECT to_person_id FROM relationships WHERE layer_id = ? AND type = 'parent_child' AND from_person_id IN (${placeholders})${whereExclude}`
    ).bind(...bindValues).all();
    return results as Array<Record<string, unknown>>;
  }

  async listChildrenForParent(layerId: string, parentId: string, excludeChildId?: string) {
    const statement = excludeChildId
        ? "SELECT to_person_id FROM relationships WHERE layer_id = ? AND type = 'parent_child' AND from_person_id = ? AND to_person_id != ?"
        : "SELECT to_person_id FROM relationships WHERE layer_id = ? AND type = 'parent_child' AND from_person_id = ?"
    ;
    const { results } = excludeChildId
      ? await this.db.prepare(statement).bind(layerId, parentId, excludeChildId).all()
      : await this.db.prepare(statement).bind(layerId, parentId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listSpouseEdges(layerId: string, personId: string) {
    const { results } = await this.db.prepare(
      "SELECT from_person_id, to_person_id FROM relationships WHERE layer_id = ? AND type = 'spouse' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(layerId, personId, personId).all();
    return results as Array<Record<string, unknown>>;
  }
}

export class D1PeopleRepository implements PeopleRepository {
  constructor(private readonly db: D1Database) {}

  async listPeople(layerId: string, includeEmail: boolean) {
    const { results } = await this.db.prepare(
      `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
       FROM people
       WHERE layer_id = ?
       ORDER BY created_at`
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async getPersonById(id: string, includeEmail: boolean) {
    const row = await this.db.prepare(
      `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people WHERE id = ?`
    ).bind(id).first();
    return row as Record<string, unknown> | null;
  }

  async getPersonByIdInLayerDetailed(personId: string, layerId: string, includeEmail: boolean) {
    const row = await this.db.prepare(
      `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at
       FROM people
       WHERE id = ? AND layer_id = ?`
    ).bind(personId, layerId).first();
    return row as Record<string, unknown> | null;
  }

  async getPersonSummaryById(id: string) {
    const row = await this.db.prepare(
      'SELECT id, layer_id, name, english_name, avatar_url, dob FROM people WHERE id = ?'
    ).bind(id).first();
    return row as Record<string, unknown> | null;
  }

  async getPersonSummaryByIdInLayer(personId: string, layerId: string) {
    const row = await this.db.prepare(
      'SELECT id, layer_id, name, english_name, avatar_url, dob FROM people WHERE id = ? AND layer_id = ?'
    ).bind(personId, layerId).first();
    return row as Record<string, unknown> | null;
  }

  async insertPerson(fields: Record<string, unknown>) {
    const entries = Object.entries(fields);
    const columns = entries.map(([column]) => column);
    const values = entries.map(([, value]) => value);
    const result = await this.db.prepare(
      `INSERT INTO people (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
    ).bind(...values).run();
    return toMutationResult(result);
  }

  async updatePersonById(id: string, updates: Record<string, unknown>) {
    const entries = Object.entries(updates);
    if (!entries.length) {
      return { lastRowId: null, changes: 0 };
    }
    const columns = entries.map(([column]) => `${column} = ?`);
    const values = entries.map(([, value]) => value);
    const result = await this.db.prepare(
      `UPDATE people SET ${columns.join(', ')} WHERE id = ?`
    ).bind(...values, id).run();
    return toMutationResult(result);
  }

  async deletePersonById(id: string) {
    const result = await this.db.prepare(
      'DELETE FROM people WHERE id = ?'
    ).bind(id).run();
    return toMutationResult(result);
  }

  async findVerifiedEmailAt(normalizedEmail: string) {
    const row = await this.db.prepare(
      `SELECT email_verified_at
       FROM users
       WHERE LOWER(TRIM(COALESCE(email, username))) = ?
         AND email_verified_at IS NOT NULL
         AND TRIM(email_verified_at) != ''
       LIMIT 1`
    ).bind(normalizedEmail).first();
    return row ? String((row as Record<string, unknown>).email_verified_at ?? '') || null : null;
  }

  async listCustomFieldRowsByLayer(layerId: string) {
    const { results } = await this.db.prepare(
      `SELECT cf.id, cf.person_id, cf.label, cf.value
       FROM person_custom_fields cf
       INNER JOIN people p ON p.id = cf.person_id
       WHERE p.layer_id = ?`
    ).bind(layerId).all();
    return results as Array<Record<string, unknown>>;
  }

  async listCustomFieldRowsByPersonId(personId: string) {
    const { results } = await this.db.prepare(
      'SELECT id, label, value FROM person_custom_fields WHERE person_id = ? ORDER BY id'
    ).bind(personId).all();
    return results as Array<Record<string, unknown>>;
  }

  async deleteCustomFieldsByPersonId(personId: string) {
    const result = await this.db.prepare(
      'DELETE FROM person_custom_fields WHERE person_id = ?'
    ).bind(personId).run();
    return toMutationResult(result);
  }

  async insertCustomField(input: {
    personId: string;
    label: string;
    value: string;
    createdAt: string;
    updatedAt: string;
  }) {
    const result = await this.db.prepare(
      'INSERT INTO person_custom_fields (person_id, label, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      input.personId,
      input.label,
      input.value,
      input.createdAt,
      input.updatedAt,
    ).run();
    return toMutationResult(result);
  }

  async getPersonByIdInLayer(personId: string, layerId: string) {
    const row = await this.db.prepare(
      'SELECT id, dob FROM people WHERE id = ? AND layer_id = ?'
    ).bind(personId, layerId).first();
    return row as Record<string, unknown> | null;
  }

  async listSiblingEdges(layerId: string, personId: string) {
    const { results } = await this.db.prepare(
      "SELECT id, from_person_id, to_person_id FROM relationships WHERE layer_id = ? AND type = 'sibling' AND (from_person_id = ? OR to_person_id = ?)"
    ).bind(layerId, personId, personId).all();
    return results as Array<Record<string, unknown>>;
  }
}

export class D1BackupRepository implements BackupRepository {
  constructor(private readonly db: D1Database) {}

  async exportAll(includeEmail: boolean) {
    const [
      layersResult,
      peopleResult,
      avatarsResult,
      relationshipsResult,
      customFieldsResult,
      relationshipTypeLabelsResult,
      kinshipLabelsResult,
    ] = await Promise.all([
      this.db.prepare(
        'SELECT id, name, description, created_at, updated_at FROM graph_layers ORDER BY created_at ASC, id ASC'
      ).all(),
      this.db.prepare(
        `SELECT id, layer_id, name, english_name, ${includeEmail ? 'email,' : ''} gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at FROM people ORDER BY layer_id ASC, created_at ASC, id ASC`
      ).all(),
      this.db.prepare(
        'SELECT id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at FROM person_avatars ORDER BY person_id ASC, sort_order ASC, created_at ASC'
      ).all(),
      this.db.prepare(
        'SELECT id, layer_id, from_person_id, to_person_id, type, metadata, created_at FROM relationships ORDER BY layer_id ASC, id ASC'
      ).all(),
      this.db.prepare(
        'SELECT id, person_id, label, value, created_at, updated_at FROM person_custom_fields ORDER BY person_id ASC, id ASC'
      ).all(),
      this.db.prepare(
        'SELECT type, label, description, created_at, updated_at FROM relationship_type_labels ORDER BY type ASC'
      ).all(),
      this.db.prepare(
        'SELECT default_title, default_formal_title, custom_title, custom_formal_title, description, created_at, updated_at FROM kinship_labels ORDER BY default_title ASC, default_formal_title ASC'
      ).all(),
    ]);

    return {
      layers: layersResult.results as Array<Record<string, unknown>>,
      people: peopleResult.results as Array<Record<string, unknown>>,
      avatars: avatarsResult.results as Array<Record<string, unknown>>,
      relationships: relationshipsResult.results as Array<Record<string, unknown>>,
      customFields: customFieldsResult.results as Array<Record<string, unknown>>,
      relationshipTypeLabels: relationshipTypeLabelsResult.results as Array<Record<string, unknown>>,
      kinshipLabels: kinshipLabelsResult.results as Array<Record<string, unknown>>,
    };
  }

  async runImportBatch(input: {
    includeEmail: boolean;
    layers: BackupLayer[];
    people: Array<{ person: BackupPerson; protectedFields: Record<string, string | null | undefined> }>;
    avatars: BackupAvatar[];
    encryptedCustomFields: Array<BackupCustomField & { encryptedValue: string }>;
    relationships: BackupRelationship[];
    relationshipTypeLabels: BackupRelationshipTypeLabel[];
    kinshipLabels: BackupKinshipLabel[];
    primaryAvatars: Map<string, string | null>;
    hasRelationshipTypeLabels: boolean;
    hasKinshipLabels: boolean;
  }) {
    const stmts: D1PreparedStatement[] = [];

    stmts.push(this.db.prepare('DELETE FROM graph_layers'));
    stmts.push(this.db.prepare('DELETE FROM relationships'));
    stmts.push(this.db.prepare('DELETE FROM person_custom_fields'));
    stmts.push(this.db.prepare('DELETE FROM person_avatars'));
    stmts.push(this.db.prepare('DELETE FROM people'));
    if (input.hasRelationshipTypeLabels) {
      stmts.push(this.db.prepare('DELETE FROM relationship_type_labels'));
    }
    if (input.hasKinshipLabels) {
      stmts.push(this.db.prepare('DELETE FROM kinship_labels'));
    }

    for (const layer of input.layers) {
      stmts.push(this.db.prepare(
        `INSERT INTO graph_layers (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(layer.id, layer.name, layer.description, layer.created_at, layer.updated_at));
    }

    for (const { person, protectedFields } of input.people) {
      stmts.push(this.db.prepare(
        `INSERT INTO people (
          id, name, english_name${input.includeEmail ? ', email' : ''}, gender, blood_type, dob, dod, tob, tod, avatar_url, metadata, created_at, updated_at, layer_id
        ) VALUES (${input.includeEmail ? '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?' : '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'})`
      ).bind(
        person.id,
        person.name,
        person.english_name,
        ...(input.includeEmail ? [person.email] : []),
        person.gender,
        protectedFields.blood_type ?? null,
        protectedFields.dob ?? null,
        protectedFields.dod ?? null,
        protectedFields.tob ?? null,
        protectedFields.tod ?? null,
        person.avatar_url,
        protectedFields.metadata ?? null,
        person.created_at,
        person.updated_at,
        person.layer_id,
      ));
    }

    for (const avatar of input.avatars) {
      stmts.push(this.db.prepare(
        `INSERT INTO person_avatars (
          id, person_id, avatar_url, storage_key, is_primary, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        avatar.id,
        avatar.person_id,
        avatar.avatar_url,
        avatar.storage_key,
        avatar.is_primary ? 1 : 0,
        avatar.sort_order,
        avatar.created_at,
        avatar.updated_at,
      ));
    }

    for (const field of input.encryptedCustomFields) {
      if (field.id !== null) {
        stmts.push(this.db.prepare(
          `INSERT INTO person_custom_fields (
            id, person_id, label, value, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          field.id,
          field.person_id,
          field.label,
          field.encryptedValue,
          field.created_at,
          field.updated_at,
        ));
      } else {
        stmts.push(this.db.prepare(
          `INSERT INTO person_custom_fields (
            person_id, label, value, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)`
        ).bind(
          field.person_id,
          field.label,
          field.encryptedValue,
          field.created_at,
          field.updated_at,
        ));
      }
    }

    for (const relation of input.relationships) {
      if (relation.id !== null) {
        stmts.push(this.db.prepare(
          `INSERT INTO relationships (
            id, from_person_id, to_person_id, type, metadata, created_at, layer_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          relation.id,
          relation.from_person_id,
          relation.to_person_id,
          relation.type,
          relation.metadata,
          relation.created_at,
          relation.layer_id,
        ));
      } else {
        stmts.push(this.db.prepare(
          `INSERT INTO relationships (
            from_person_id, to_person_id, type, metadata, created_at, layer_id
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          relation.from_person_id,
          relation.to_person_id,
          relation.type,
          relation.metadata,
          relation.created_at,
          relation.layer_id,
        ));
      }
    }

    if (input.hasRelationshipTypeLabels) {
      for (const item of input.relationshipTypeLabels) {
        stmts.push(this.db.prepare(
          `INSERT INTO relationship_type_labels (
            type, label, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)`
        ).bind(item.type, item.label, item.description, item.created_at, item.updated_at));
      }
    }

    if (input.hasKinshipLabels) {
      for (const item of input.kinshipLabels) {
        stmts.push(this.db.prepare(
          `INSERT INTO kinship_labels (
            default_title, default_formal_title, custom_title, custom_formal_title, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          item.default_title,
          item.default_formal_title,
          item.custom_title,
          item.custom_formal_title,
          item.description,
          item.created_at,
          item.updated_at,
        ));
      }
    }

    for (const [personId, avatarUrl] of input.primaryAvatars) {
      stmts.push(this.db.prepare(
        'UPDATE people SET avatar_url = ? WHERE id = ?'
      ).bind(avatarUrl, personId));
    }

    await this.db.batch(stmts);
  }
}

export const createGraphRepository = (env: Env): GraphRepository => new D1GraphRepository(env);

export const createRelationshipRepository = (db: D1Database): RelationshipRepository => (
  new D1RelationshipRepository(db)
);

export const createPeopleRepository = (db: D1Database): PeopleRepository => (
  new D1PeopleRepository(db)
);

export const createBackupRepository = (db: D1Database): BackupRepository => (
  new D1BackupRepository(db)
);
