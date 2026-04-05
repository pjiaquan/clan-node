import test from 'node:test';
import assert from 'node:assert/strict';
import type { Env } from '../types';
import type { RelationshipRepository } from '../repositories';
import {
  getSiblingIds,
  linkSpouseToChild,
  linkSiblingNetworks,
} from './service';

class MockRelationshipRepository implements RelationshipRepository {
  relationships: Array<Record<string, unknown>> = [];
  people = new Map<string, Array<Record<string, unknown>>>();
  nextId = 100;

  async listRelationships(layerId: string) {
    return this.relationships.filter((row) => row.layer_id === layerId);
  }

  async getRelationshipById(id: string) {
    return this.relationships.find((row) => String(row.id) === id) ?? null;
  }

  async personExists(layerId: string, personId: string) {
    return Boolean(this.people.get(layerId)?.some((row) => row.id === personId));
  }

  async findRelationship(layerId: string, type: any, fromPersonId: string, toPersonId: string, bidirectional = false) {
    return this.relationships.find((row) => (
      row.layer_id === layerId
      && row.type === type
      && (
        (row.from_person_id === fromPersonId && row.to_person_id === toPersonId)
        || (
          bidirectional
          && row.from_person_id === toPersonId
          && row.to_person_id === fromPersonId
        )
      )
    )) ?? null;
  }

  async createRelationship(input: {
    layerId: string;
    fromPersonId: string;
    toPersonId: string;
    type: any;
    metadata: string | null;
    createdAt: string;
  }) {
    const id = this.nextId++;
    this.relationships.push({
      id,
      layer_id: input.layerId,
      from_person_id: input.fromPersonId,
      to_person_id: input.toPersonId,
      type: input.type,
      metadata: input.metadata,
      created_at: input.createdAt,
    });
    return { lastRowId: id, changes: 1 };
  }

  async updateRelationshipById(id: string, updates: Record<string, unknown>) {
    const row = this.relationships.find((item) => String(item.id) === id);
    if (!row) return { lastRowId: null, changes: 0 };
    Object.assign(row, updates);
    return { lastRowId: null, changes: 1 };
  }

  async deleteRelationshipById(id: string) {
    const before = this.relationships.length;
    this.relationships = this.relationships.filter((row) => String(row.id) !== id);
    return { lastRowId: null, changes: before - this.relationships.length };
  }

  async listPeopleByIds(layerId: string, personIds: string[]) {
    return (this.people.get(layerId) ?? []).filter((row) => personIds.includes(String(row.id)));
  }

  async listSiblingEdges(layerId: string, personId: string) {
    return this.relationships.filter((row) => (
      row.layer_id === layerId
      && row.type === 'sibling'
      && (row.from_person_id === personId || row.to_person_id === personId)
    ));
  }

  async listParentEdgesForChild(layerId: string, childId: string) {
    return this.relationships
      .filter((row) => row.layer_id === layerId && row.type === 'parent_child' && row.to_person_id === childId)
      .map((row) => ({ from_person_id: row.from_person_id }));
  }

  async listChildrenForParents(layerId: string, parentIds: string[], excludeChildId?: string) {
    return this.relationships.filter((row) => (
      row.layer_id === layerId
      && row.type === 'parent_child'
      && parentIds.includes(String(row.from_person_id))
      && row.to_person_id !== excludeChildId
    )).map((row) => ({ to_person_id: row.to_person_id }));
  }

  async listChildrenForParent(layerId: string, parentId: string, excludeChildId?: string) {
    return this.relationships.filter((row) => (
      row.layer_id === layerId
      && row.type === 'parent_child'
      && row.from_person_id === parentId
      && row.to_person_id !== excludeChildId
    )).map((row) => ({ to_person_id: row.to_person_id }));
  }

  async listSpouseEdges(layerId: string, personId: string) {
    return this.relationships.filter((row) => (
      row.layer_id === layerId
      && row.type === 'spouse'
      && (row.from_person_id === personId || row.to_person_id === personId)
    ));
  }
}

const createEnv = (): Env => ({
  DB: {
    prepare() {
      throw new Error('unexpected DB access in relationship service test');
    },
  } as unknown as D1Database,
  AVATARS: {} as R2Bucket,
});

test('getSiblingIds combines direct sibling edges with shared-parent siblings', async () => {
  const repository = new MockRelationshipRepository();
  repository.relationships = [
    { id: 1, layer_id: 'default', from_person_id: 'alice', to_person_id: 'bob', type: 'sibling' },
    { id: 2, layer_id: 'default', from_person_id: 'parent', to_person_id: 'alice', type: 'parent_child' },
    { id: 3, layer_id: 'default', from_person_id: 'parent', to_person_id: 'carol', type: 'parent_child' },
  ];

  const siblingIds = await getSiblingIds(repository, 'default', 'alice');

  assert.deepEqual(siblingIds.sort(), ['bob', 'carol']);
});

test('linkSpouseToChild adds missing parent-child link for spouse and records inserted ids', async () => {
  const repository = new MockRelationshipRepository();
  const env = createEnv();
  repository.relationships = [
    { id: 1, layer_id: 'default', from_person_id: 'parent-a', to_person_id: 'parent-b', type: 'spouse' },
  ];
  const createdRelationshipIds: number[] = [];

  const linked = await linkSpouseToChild(
    repository,
    env,
    'default',
    'parent-a',
    'child-1',
    '2026-04-05T00:00:00.000Z',
    createdRelationshipIds,
  );

  assert.deepEqual(linked, ['parent-b']);
  assert.equal(createdRelationshipIds.length, 1);
  assert.ok(repository.relationships.some((row) => (
    row.type === 'parent_child'
    && row.from_person_id === 'parent-b'
    && row.to_person_id === 'child-1'
  )));
});

test('linkSiblingNetworks links two sibling groups together without duplicating existing edges', async () => {
  const repository = new MockRelationshipRepository();
  const env = createEnv();
  repository.people.set('default', [
    { id: 'alice', dob: null },
    { id: 'bob', dob: null },
    { id: 'carol', dob: null },
    { id: 'dave', dob: null },
  ]);
  repository.relationships = [
    { id: 1, layer_id: 'default', from_person_id: 'alice', to_person_id: 'bob', type: 'sibling' },
    { id: 2, layer_id: 'default', from_person_id: 'carol', to_person_id: 'dave', type: 'sibling' },
  ];

  await linkSiblingNetworks(
    repository,
    env,
    'default',
    'alice',
    'carol',
    '2026-04-05T00:00:00.000Z',
  );

  const siblingPairs = repository.relationships
    .filter((row) => row.type === 'sibling')
    .map((row) => [row.from_person_id, row.to_person_id].join('->'))
    .sort();

  assert.ok(siblingPairs.includes('alice->dave'));
  assert.ok(siblingPairs.includes('carol->bob'));
  assert.equal(new Set(siblingPairs).size, siblingPairs.length);
});
