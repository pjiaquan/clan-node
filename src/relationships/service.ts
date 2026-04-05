import type { Env, RelationshipType } from '../types';
import type { RelationshipRepository, RepositoryMutationResult } from '../repositories';
import { safeParse, safeParseObject } from '../utils';
import {
  buildSiblingLinkMeta,
  PARENT_CHILD_METADATA,
  SPOUSE_METADATA,
  type SiblingHandlePreference,
} from '../relationship_utils';
import { decryptProtectedValue } from '../data_protection';

export { PARENT_CHILD_METADATA, SPOUSE_METADATA };

export const RELATIONSHIP_TYPES: RelationshipType[] = ['parent_child', 'spouse', 'ex_spouse', 'sibling', 'in_law'];

export const isRelationshipType = (value: unknown): value is RelationshipType => (
  value === 'parent_child'
  || value === 'spouse'
  || value === 'ex_spouse'
  || value === 'sibling'
  || value === 'in_law'
);

export const parseRelationshipRows = (results: Array<Record<string, unknown>>) => (
  results.map((rel) => ({
    ...rel,
    metadata: safeParse(rel.metadata as string | null | undefined),
  }))
);

export const summarizeRelationshipMetadata = (metadata: unknown) => (
  typeof metadata === 'string' ? safeParseObject(metadata) : metadata
);

const mutationHasInsert = (result: RepositoryMutationResult) => result.lastRowId !== null;
const collectInsertedRowId = (result: RepositoryMutationResult, collector?: number[]) => {
  if (!collector || result.lastRowId === null) return;
  collector.push(result.lastRowId);
};

export async function getSiblingLinkMeta(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  aId: string,
  bId: string,
  preferredHandles?: SiblingHandlePreference,
) {
  const results = await repository.listPeopleByIds(layerId, [aId, bId]);

  const a = results.find((person) => person.id === aId) as Record<string, unknown> | undefined;
  const b = results.find((person) => person.id === bId) as Record<string, unknown> | undefined;
  const aDob = a?.dob ? new Date((await decryptProtectedValue(env, a.dob as string | null)) || '').getTime() : 0;
  const bDob = b?.dob ? new Date((await decryptProtectedValue(env, b.dob as string | null)) || '').getTime() : 0;
  return buildSiblingLinkMeta(aId, bId, aDob, bDob, preferredHandles);
}

export async function getSiblingIds(repository: RelationshipRepository, layerId: string, personId: string) {
  const ids = new Set<string>();

  const siblingEdges = await repository.listSiblingEdges(layerId, personId);
  for (const rel of siblingEdges) {
    const otherId = rel.from_person_id === personId ? rel.to_person_id : rel.from_person_id;
    if (typeof otherId === 'string' && otherId !== personId) {
      ids.add(otherId);
    }
  }

  const parentEdges = await repository.listParentEdgesForChild(layerId, personId);
  const parentIds = parentEdges
    .map((edge) => edge.from_person_id)
    .filter((id): id is string => typeof id === 'string');
  if (parentIds.length) {
    const siblingChildren = await repository.listChildrenForParents(layerId, parentIds, personId);
    for (const rel of siblingChildren) {
      const siblingId = rel.to_person_id;
      if (typeof siblingId === 'string' && siblingId !== personId) {
        ids.add(siblingId);
      }
    }
  }

  return [...ids];
}

export async function getPersonNameMap(
  repository: RelationshipRepository,
  layerId: string,
  personIds: Array<string | null | undefined>,
) {
  const uniqueIds = [...new Set(
    personIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
  )];
  const map = new Map<string, string>();
  if (!uniqueIds.length) return map;

  const results = await repository.listPeopleByIds(layerId, uniqueIds);
  for (const row of results) {
    if (typeof row.id === 'string') {
      map.set(row.id, typeof row.name === 'string' ? row.name : '');
    }
  }
  return map;
}

export async function ensureSiblingLink(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  aId: string,
  bId: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  if (aId === bId) return;
  const exists = await repository.findRelationship(layerId, 'sibling', aId, bId, true);
  if (exists) return;

  const link = await getSiblingLinkMeta(repository, env, layerId, aId, bId);
  const result = await repository.createRelationship({
    layerId,
    fromPersonId: link.fromId,
    toPersonId: link.toId,
    type: 'sibling',
    metadata: link.metadata,
    createdAt: now,
  });
  if (mutationHasInsert(result)) {
    collectInsertedRowId(result, createdRelationshipIds);
  }
}

export async function linkSiblingNetworks(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  personA: string,
  personB: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  const [siblingsA, siblingsB] = await Promise.all([
    getSiblingIds(repository, layerId, personA),
    getSiblingIds(repository, layerId, personB),
  ]);

  for (const siblingId of siblingsB) {
    if (siblingId !== personA) {
      await ensureSiblingLink(repository, env, layerId, personA, siblingId, now, createdRelationshipIds);
    }
  }

  for (const siblingId of siblingsA) {
    if (siblingId !== personB) {
      await ensureSiblingLink(repository, env, layerId, personB, siblingId, now, createdRelationshipIds);
    }
  }
}

export async function ensureParentChildLink(
  repository: RelationshipRepository,
  layerId: string,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  if (parentId === childId) return;
  const exists = await repository.findRelationship(layerId, 'parent_child', parentId, childId);
  if (exists) return;

  const result = await repository.createRelationship({
    layerId,
    fromPersonId: parentId,
    toPersonId: childId,
    type: 'parent_child',
    metadata: PARENT_CHILD_METADATA,
    createdAt: now,
  });
  if (mutationHasInsert(result)) {
    collectInsertedRowId(result, createdRelationshipIds);
  }
}

export async function linkParentToSiblingChildren(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  const siblingIds = await getSiblingIds(repository, layerId, childId);
  for (const siblingId of siblingIds) {
    await ensureParentChildLink(repository, layerId, parentId, siblingId, now, createdRelationshipIds);
    await linkSiblingNetworks(repository, env, layerId, childId, siblingId, now, createdRelationshipIds);
  }
}

export async function getChildIds(repository: RelationshipRepository, layerId: string, parentId: string) {
  const results = await repository.listChildrenForParent(layerId, parentId);
  return results
    .map((row) => row.to_person_id)
    .filter((id): id is string => typeof id === 'string');
}

export async function linkSpouseToChild(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  parentId: string,
  childId: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  const results = await repository.listSpouseEdges(layerId, parentId);

  const spouseIds = new Set<string>();
  for (const rel of results) {
    const spouseId = rel.from_person_id === parentId ? rel.to_person_id : rel.from_person_id;
    if (typeof spouseId === 'string' && spouseId !== parentId) {
      spouseIds.add(spouseId);
    }
  }

  if (!spouseIds.size) return [] as string[];

  const linked: string[] = [];
  for (const spouseId of spouseIds) {
    const existingParentChild = await repository.findRelationship(layerId, 'parent_child', spouseId, childId);

    if (!existingParentChild) {
      const result = await repository.createRelationship({
        layerId,
        fromPersonId: spouseId,
        toPersonId: childId,
        type: 'parent_child',
        metadata: PARENT_CHILD_METADATA,
        createdAt: now,
      });
      if (mutationHasInsert(result)) {
        collectInsertedRowId(result, createdRelationshipIds);
      }
    }

    await linkParentToSiblingChildren(repository, env, layerId, spouseId, childId, now, createdRelationshipIds);
    linked.push(spouseId);
  }

  return linked;
}

export async function linkSpousePairExistingChildren(
  repository: RelationshipRepository,
  env: Env,
  layerId: string,
  personA: string,
  personB: string,
  now: string,
  createdRelationshipIds?: number[],
) {
  const [aChildren, bChildren] = await Promise.all([
    getChildIds(repository, layerId, personA),
    getChildIds(repository, layerId, personB),
  ]);

  for (const childId of aChildren) {
    await ensureParentChildLink(repository, layerId, personB, childId, now, createdRelationshipIds);
    await linkParentToSiblingChildren(repository, env, layerId, personB, childId, now, createdRelationshipIds);
  }

  for (const childId of bChildren) {
    await ensureParentChildLink(repository, layerId, personA, childId, now, createdRelationshipIds);
    await linkParentToSiblingChildren(repository, env, layerId, personA, childId, now, createdRelationshipIds);
  }
}
