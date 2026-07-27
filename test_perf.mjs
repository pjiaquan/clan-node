import { performance } from 'perf_hooks';
import { resolve } from 'path';

// Mock repository
const mockRepository = {
  listChildrenForParent: async (layerId, from, to) => {
    // Generate 100 mock children
    return Array.from({ length: 100 }).map((_, i) => ({ to_person_id: `child_${i}` }));
  },
  findRelationship: async (layerId, type, nextTo, siblingId, flag) => {
    // Simulate some missing relationships
    await new Promise(r => setTimeout(r, 1));
    return Math.random() > 0.5 ? { id: 'some_id' } : null;
  },
  createRelationship: async (data) => {
    await new Promise(r => setTimeout(r, 1));
    return { lastRowId: 'new_id' };
  }
};

const mockEnv = {};
const layerId = 'layer1';
const nextTo = 'parentA';
const now = '2023-01-01T00:00:00Z';

// Mock functions
const getSiblingLinkMeta = async (repo, env, layer, to, sibling) => {
  return { fromId: to, toId: sibling, metadata: '{}' };
};

const linkSiblingNetworks = async (repo, env, layer, to, sibling, time) => {
  await new Promise(r => setTimeout(r, 1));
};

async function testSequential() {
  const otherChildren = await mockRepository.listChildrenForParent(layerId, 'nextFrom', nextTo);
  const start = performance.now();

  for (const child of otherChildren) {
    const siblingId = child.to_person_id;
    const existingSibling = await mockRepository.findRelationship(layerId, 'sibling', nextTo, siblingId, true);
    if (!existingSibling) {
      const link = await getSiblingLinkMeta(mockRepository, mockEnv, layerId, nextTo, siblingId);
      await mockRepository.createRelationship({
        layerId,
        fromPersonId: link.fromId,
        toPersonId: link.toId,
        type: 'sibling',
        metadata: link.metadata,
        createdAt: now,
      });
    }
    await linkSiblingNetworks(mockRepository, mockEnv, layerId, nextTo, siblingId, now);
  }

  const end = performance.now();
  console.log(`Sequential took ${end - start}ms`);
}

async function testParallel() {
  const otherChildren = await mockRepository.listChildrenForParent(layerId, 'nextFrom', nextTo);
  const start = performance.now();

  await Promise.all(otherChildren.map(async (child) => {
    const siblingId = child.to_person_id;
    const existingSibling = await mockRepository.findRelationship(layerId, 'sibling', nextTo, siblingId, true);
    if (!existingSibling) {
      const link = await getSiblingLinkMeta(mockRepository, mockEnv, layerId, nextTo, siblingId);
      await mockRepository.createRelationship({
        layerId,
        fromPersonId: link.fromId,
        toPersonId: link.toId,
        type: 'sibling',
        metadata: link.metadata,
        createdAt: now,
      });
    }
    await linkSiblingNetworks(mockRepository, mockEnv, layerId, nextTo, siblingId, now);
  }));

  const end = performance.now();
  console.log(`Parallel took ${end - start}ms`);
}

async function run() {
  await testSequential();
  await testParallel();
}

run();
