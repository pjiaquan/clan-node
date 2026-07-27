import { linkSpousePairExistingChildren } from './src/relationships/service';
import { validateRelations } from './src/backup/service.js';
import type { RelationshipRepository } from './src/repositories';
import type { Env } from './src/types';
import { D1PeopleRepository } from './src/d1_repositories.ts';
import Database from 'better-sqlite3';
import { performance } from 'perf_hooks';

class MockSlowRepository implements RelationshipRepository {
  async listChildrenForParent(layerId: string, parentId: string) {
    if (parentId === 'A') {
      return Array.from({ length: 50 }).map((_, i) => ({ to_person_id: `childA${i}` }));
    }
    if (parentId === 'B') {
      return Array.from({ length: 50 }).map((_, i) => ({ to_person_id: `childB${i}` }));
    }
    return [];
  }

  async findRelationship() {
    await new Promise(resolve => setTimeout(resolve, 5)); // 5ms delay
    return null;
  }

  async createRelationship() {
    await new Promise(resolve => setTimeout(resolve, 5)); // 5ms delay
    return { lastRowId: 1, changes: 1 };
  }

  async listSiblingEdges() {
    return [];
  }

  async listParentEdgesForChild() {
    return [];
  }
}

async function runSpouseLinkBenchmark() {
  const repo = new MockSlowRepository();
  const env = {} as Env;

  const start = Date.now();
  await linkSpousePairExistingChildren(repo, env, 'layer', 'A', 'B', new Date().toISOString(), []);
  const end = Date.now();

  console.log(`[SpouseLink] Time taken: ${end - start}ms`);
}

function runValidateRelationsBenchmark() {
  const layers = [{ id: 'layer1', name: 'layer1', description: '', created_at: '', updated_at: '' }];
  const people: any[] = [];
  const relationships: any[] = [];
  for (let i = 0; i < 5000; i++) {
    people.push({ id: `p${i}`, layer_id: 'layer1' });
  }
  for (let i = 0; i < 5000; i++) {
    relationships.push({
      from_person_id: `p${i}`,
      to_person_id: `p${(i + 1) % 5000}`,
      layer_id: 'layer1',
    });
  }

  console.time('validateRelations');
  for (let i = 0; i < 10; i++) {
    validateRelations(layers, people, [], relationships, []);
  }
  console.timeEnd('validateRelations');
}

async function runCustomFieldsBenchmark() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE person_custom_fields (
      person_id TEXT,
      label TEXT,
      value TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  const d1Mock = {
    prepare: (query: string) => {
      const stmt = db.prepare(query);
      return {
        bind: (...args: any[]) => ({
          run: async () => { stmt.run(...args); return { success: true, meta: { last_row_id: 1, changes: 1 } }; },
          all: async () => ({ results: stmt.all() }),
          first: async () => stmt.get()
        })
      };
    }
  };

  const repo = new D1PeopleRepository(d1Mock as any);
  const customFields = Array.from({ length: 500 }, (_, i) => ({
    label: `label_${i}`,
    value: `value_${i}`
  }));

  const c = { env: { DATA_PROTECTION_KEY: 'test-key' } };
  const encryptProtectedValue = async (env: any, val: string) => val;
  const now = new Date().toISOString();
  const id = 'person-123';

  const start = performance.now();
  if (customFields !== null) {
    const promises = customFields
      .filter(field => field?.label || field?.value)
      .map(async field => {
        return repo.insertCustomField({
          personId: id,
          label: field.label || '',
          value: (await encryptProtectedValue(c.env, field.value || '')) || '',
          createdAt: now,
          updatedAt: now,
        });
      });
    await Promise.all(promises);
  }
  const end = performance.now();
  console.log(`[CustomFields] Concurrent: ${end - start} ms`);
}

async function main() {
  await runSpouseLinkBenchmark();
  runValidateRelationsBenchmark();
  await runCustomFieldsBenchmark();
}

main().catch(console.error);
