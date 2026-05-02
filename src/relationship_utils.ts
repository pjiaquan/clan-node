export type SiblingHandlePreference = {
  sourceHandle?: string;
  targetHandle?: string;
};

type SiblingLink = {
  fromId: string;
  toId: string;
  metadata: string;
};

const HORIZONTAL_RELATIONSHIP_METADATA = JSON.stringify({
  sourceHandle: 'left-s',
  targetHandle: 'right-t'
});

const SIBLING_BY_AGE_METADATA = HORIZONTAL_RELATIONSHIP_METADATA;

const SIBLING_DEFAULT_METADATA = HORIZONTAL_RELATIONSHIP_METADATA;

export const PARENT_CHILD_METADATA = JSON.stringify({
  sourceHandle: 'bottom-s',
  targetHandle: 'top-t'
});

export const SPOUSE_METADATA = HORIZONTAL_RELATIONSHIP_METADATA;

export function trackInsertedRowId(result: any, collector?: number[]) {
  if (!collector) return;
  const rawId = result?.meta?.last_row_id;
  if (typeof rawId === 'number') {
    collector.push(rawId);
    return;
  }
  if (typeof rawId === 'string') {
    const parsed = Number(rawId);
    if (Number.isFinite(parsed)) {
      collector.push(parsed);
    }
  }
}

export function buildSiblingLinkMeta(
  aId: string,
  bId: string,
  aDob: number,
  bDob: number,
  preferredHandles?: SiblingHandlePreference
): SiblingLink {
  if (aDob && bDob && aDob !== bDob) {
    const olderId = aDob < bDob ? aId : bId;
    const youngerId = olderId === aId ? bId : aId;
    return {
      fromId: olderId,
      toId: youngerId,
      metadata: SIBLING_BY_AGE_METADATA
    };
  }

  if (preferredHandles?.sourceHandle && preferredHandles?.targetHandle) {
    return {
      fromId: aId,
      toId: bId,
      metadata: JSON.stringify({
        sourceHandle: preferredHandles.sourceHandle,
        targetHandle: preferredHandles.targetHandle
      })
    };
  }

  return {
    fromId: aId,
    toId: bId,
    metadata: SIBLING_DEFAULT_METADATA
  };
}
