import { linkSpousePairExistingChildren } from './src/relationships/service';
import { validateRelations } from './src/backup/service.js';
import type { RelationshipRepository } from './src/repositories';
import type { Env } from './src/types';

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

async function main() {
  await runSpouseLinkBenchmark();
  runValidateRelationsBenchmark();
}

main().catch(console.error);
