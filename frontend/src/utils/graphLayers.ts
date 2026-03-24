import type { Person, Relationship } from '../types';

export const GRAPH_LAYER_BUNDLE_VERSION = 1;

export type GraphLayer = {
  id: string;
  name: string;
  center: string;
  nodes: Person[];
  edges: Relationship[];
  createdAt: string;
  updatedAt: string;
};

export type GraphLayerBundle = {
  version: number;
  activeLayerId: string;
  layers: GraphLayer[];
};

type CreateGraphLayerInput = {
  id?: string;
  name?: string;
  now?: string;
};

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `layer-${Math.random().toString(36).slice(2, 10)}`
);

const assertNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const normalizePerson = (value: unknown): Person => {
  const item = value as Partial<Person> | null | undefined;
  return {
    id: assertNonEmptyString(item?.id, 'node.id'),
    name: assertNonEmptyString(item?.name, 'node.name'),
    english_name: typeof item?.english_name === 'string' ? item.english_name : null,
    email: typeof item?.email === 'string' ? item.email : null,
    gender: item?.gender === 'M' || item?.gender === 'F' || item?.gender === 'O' ? item.gender : 'O',
    blood_type: typeof item?.blood_type === 'string' ? item.blood_type : null,
    dob: typeof item?.dob === 'string' ? item.dob : null,
    dod: typeof item?.dod === 'string' ? item.dod : null,
    tob: typeof item?.tob === 'string' ? item.tob : null,
    tod: typeof item?.tod === 'string' ? item.tod : null,
    avatar_url: typeof item?.avatar_url === 'string' ? item.avatar_url : null,
    title: typeof item?.title === 'string' ? item.title : undefined,
    formal_title: typeof item?.formal_title === 'string' ? item.formal_title : undefined,
    metadata: item?.metadata && typeof item.metadata === 'object' ? cloneJson(item.metadata) : null,
  };
};

const normalizeRelationship = (value: unknown): Relationship => {
  const item = value as Partial<Relationship> | null | undefined;
  const id = item?.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    throw new Error('edge.id must be a finite number');
  }
  return {
    id,
    from_person_id: assertNonEmptyString(item?.from_person_id, 'edge.from_person_id'),
    to_person_id: assertNonEmptyString(item?.to_person_id, 'edge.to_person_id'),
    type: assertNonEmptyString(item?.type, 'edge.type'),
    metadata: item?.metadata && typeof item.metadata === 'object' ? cloneJson(item.metadata) : null,
  };
};

const createExampleNodes = (layerName: string) => {
  const rootId = createId();
  const leftId = createId();
  const rightId = createId();

  const nodes: Person[] = [
    {
      id: rootId,
      name: `${layerName} Root`,
      english_name: null,
      email: null,
      gender: 'O',
      blood_type: null,
      dob: null,
      dod: null,
      tob: null,
      tod: null,
      avatar_url: null,
      title: 'Example Root',
      metadata: { position: { x: 0, y: 0 } },
    },
    {
      id: leftId,
      name: `${layerName} Node A`,
      english_name: null,
      email: null,
      gender: 'O',
      blood_type: null,
      dob: null,
      dod: null,
      tob: null,
      tod: null,
      avatar_url: null,
      title: 'Example Child',
      metadata: { position: { x: -220, y: 160 } },
    },
    {
      id: rightId,
      name: `${layerName} Node B`,
      english_name: null,
      email: null,
      gender: 'O',
      blood_type: null,
      dob: null,
      dod: null,
      tob: null,
      tod: null,
      avatar_url: null,
      title: 'Example Child',
      metadata: { position: { x: 220, y: 160 } },
    },
  ];

  const edges: Relationship[] = [
    {
      id: 1,
      from_person_id: rootId,
      to_person_id: leftId,
      type: 'parent_child',
      metadata: { sourceHandle: 'bottom-s', targetHandle: 'top-t' },
    },
    {
      id: 2,
      from_person_id: rootId,
      to_person_id: rightId,
      type: 'parent_child',
      metadata: { sourceHandle: 'bottom-s', targetHandle: 'top-t' },
    },
  ];

  return {
    center: rootId,
    nodes,
    edges,
  };
};

const normalizeLayer = (value: unknown): GraphLayer => {
  const item = value as Partial<GraphLayer> | null | undefined;
  const nodes = Array.isArray(item?.nodes) ? item.nodes.map(normalizePerson) : [];
  const edges = Array.isArray(item?.edges) ? item.edges.map(normalizeRelationship) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodeIds.size !== nodes.length) {
    throw new Error('layer contains duplicate node ids');
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from_person_id) || !nodeIds.has(edge.to_person_id)) {
      throw new Error(`layer edge ${edge.id} references a node outside the layer`);
    }
  }

  const center = assertNonEmptyString(item?.center, 'layer.center');
  if (!nodeIds.has(center)) {
    throw new Error('layer.center must reference a node in the same layer');
  }

  return {
    id: assertNonEmptyString(item?.id, 'layer.id'),
    name: assertNonEmptyString(item?.name, 'layer.name'),
    center,
    nodes,
    edges,
    createdAt: assertNonEmptyString(item?.createdAt, 'layer.createdAt'),
    updatedAt: assertNonEmptyString(item?.updatedAt, 'layer.updatedAt'),
  };
};

export const createGraphLayer = (input: CreateGraphLayerInput = {}): GraphLayer => {
  const now = input.now ?? new Date().toISOString();
  const name = input.name?.trim() || 'New Layer';
  const { center, nodes, edges } = createExampleNodes(name);
  return {
    id: input.id ?? createId(),
    name,
    center,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
};

export const addGraphLayer = (
  bundle: GraphLayerBundle | null | undefined,
  input: CreateGraphLayerInput = {}
): GraphLayerBundle => {
  const nextLayer = createGraphLayer(input);
  const previous = bundle ? importGraphLayerBundle(bundle) : null;
  return {
    version: GRAPH_LAYER_BUNDLE_VERSION,
    activeLayerId: nextLayer.id,
    layers: [...(previous?.layers ?? []), nextLayer],
  };
};

export const exportGraphLayerBundle = (bundle: GraphLayerBundle): string => (
  JSON.stringify(importGraphLayerBundle(bundle), null, 2)
);

export const importGraphLayerBundle = (
  input: string | GraphLayerBundle | Record<string, unknown>
): GraphLayerBundle => {
  const parsed = typeof input === 'string'
    ? JSON.parse(input) as Record<string, unknown>
    : input;
  const candidate = parsed as Partial<GraphLayerBundle> | null | undefined;
  const version = candidate?.version;
  if (version !== GRAPH_LAYER_BUNDLE_VERSION) {
    throw new Error(`Unsupported graph layer bundle version: ${String(version)}`);
  }

  const layers = Array.isArray(candidate?.layers) ? candidate.layers.map(normalizeLayer) : [];
  if (!layers.length) {
    throw new Error('Graph layer bundle must contain at least one layer');
  }

  const layerIds = new Set(layers.map((layer) => layer.id));
  if (layerIds.size !== layers.length) {
    throw new Error('Graph layer bundle contains duplicate layer ids');
  }

  const activeLayerId = assertNonEmptyString(candidate?.activeLayerId, 'activeLayerId');
  if (!layerIds.has(activeLayerId)) {
    throw new Error('activeLayerId must reference an existing layer');
  }

  return {
    version,
    activeLayerId,
    layers: cloneJson(layers),
  };
};
