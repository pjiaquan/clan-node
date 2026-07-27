import { linkSpousePairExistingChildren } from './src/relationships/service';
import type { RelationshipRepository, RepositoryMutationResult } from './src/repositories';
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

async function run() {
  const repo = new MockSlowRepository();
  const env = {} as Env;

  const start = Date.now();
  await linkSpousePairExistingChildren(repo, env, 'layer', 'A', 'B', new Date().toISOString(), []);
  const end = Date.now();

  console.log(`Time taken: ${end - start}ms`);
}

run().catch(console.error);
