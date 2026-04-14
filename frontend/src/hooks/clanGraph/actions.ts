import type { Dispatch, SetStateAction } from 'react';
import type { GraphData, GraphLayer, Person } from '../../types';
import { api } from '../../api';
import {
  clearStoredLayerState,
  defaultCenterId,
  getCenterStorageKey,
  parseMetadata,
  persistCenterId,
  persistLastEditedFocus,
  queueLayerFocus,
} from './storage';

type SetGraphData = Dispatch<SetStateAction<GraphData | null>>;
type SetLayers = Dispatch<SetStateAction<GraphLayer[]>>;
type SetCenterId = Dispatch<SetStateAction<string>>;
type SetError = Dispatch<SetStateAction<string | null>>;
type SetLoading = Dispatch<SetStateAction<boolean>>;

export const loadLayerCenter = async (
  layer: GraphLayer | null,
  layerId: string,
  setCenterIdState: SetCenterId,
  setError: SetError,
) => {
  try {
    const storedCenter = localStorage.getItem(getCenterStorageKey(layerId));
    if (storedCenter) {
      setCenterIdState(storedCenter);
      queueLayerFocus(layerId, storedCenter);
      return;
    }
  } catch {
    // Ignore localStorage errors and fall back to API initialization.
  }

  const nextCenterId = layer?.center_id || defaultCenterId;
  if (nextCenterId) {
    setCenterIdState(nextCenterId);
    persistCenterId(layerId, nextCenterId);
    queueLayerFocus(layerId, nextCenterId);
    return;
  }

  setCenterIdState('');
  setError('No people found');
};

export const fetchLayersAction = async (setLayers: SetLayers) => {
  const items = await api.fetchLayers();
  setLayers(items);
  return items;
};

export const fetchGraphAction = async (
  centerId: string,
  activeLayerId: string,
  enabled: boolean,
  setLoading: SetLoading,
  setError: SetError,
  setGraphData: SetGraphData,
) => {
  if (!centerId || !activeLayerId || !enabled) return;
  try {
    setLoading(true);
    setError(null);
    const data = await api.fetchGraph(centerId, activeLayerId);
    setGraphData(data);
  } catch (err) {
    console.error('Failed to fetch graph:', err);
    setError(err instanceof Error ? err.message : 'Unknown error');
  } finally {
    setLoading(false);
  }
};

export const refreshEdgesAction = async (activeLayerId: string, setGraphData: SetGraphData) => {
  if (!activeLayerId) return;
  try {
    const relationships = await api.fetchRelationships(activeLayerId);
    setGraphData((prev) => (prev ? { ...prev, edges: relationships } : prev));
  } catch (error) {
    console.error('Failed to refresh edges:', error);
  }
};

export const refreshNodesAction = async (
  centerId: string,
  activeLayerId: string,
  setGraphData: SetGraphData,
) => {
  if (!centerId || !activeLayerId) return;
  try {
    const data = await api.fetchGraph(centerId, activeLayerId);
    setGraphData((prev) => (prev ? { ...prev, nodes: data.nodes } : data));
  } catch (error) {
    console.error('Failed to refresh nodes:', error);
  }
};

export const createLayerAction = async (
  name: string,
  fetchLayers: () => Promise<GraphLayer[]>,
  setActiveLayerIdState: SetCenterId,
  setCenterIdState: SetCenterId,
) => {
  const created = await api.createLayer(name);
  const updatedLayers = await fetchLayers();
  const nextLayerId = created.layer.id || updatedLayers[0]?.id || '';
  if (nextLayerId) {
    setActiveLayerIdState(nextLayerId);
    if (created.center_id) {
      setCenterIdState(created.center_id);
      persistCenterId(nextLayerId, created.center_id);
      queueLayerFocus(nextLayerId, created.center_id);
    }
  }
  return created;
};

export const deleteLayerAction = async (
  layerId: string,
  activeLayerId: string,
  fetchLayers: () => Promise<GraphLayer[]>,
  setActiveLayerIdState: SetCenterId,
  setCenterIdState: SetCenterId,
  setGraphData: SetGraphData,
) => {
  await api.deleteLayer(layerId);
  clearStoredLayerState(layerId);

  const updatedLayers = await fetchLayers();
  const nextLayerId = updatedLayers.find((layer) => layer.id !== layerId)?.id || updatedLayers[0]?.id || '';

  if (activeLayerId === layerId) {
    if (nextLayerId) {
      setActiveLayerIdState(nextLayerId);
    } else {
      setActiveLayerIdState('');
    }
    setCenterIdState('');
    setGraphData(null);
  }

  return {
    nextLayerId,
    layers: updatedLayers,
  };
};

export const updatePersonAction = async (
  id: string,
  updates: unknown,
  activeLayerId: string,
  fetchGraph: () => Promise<void>,
  options?: { focusZoom?: number },
) => {
  const focusZoom = options?.focusZoom ?? 1.0;
  persistLastEditedFocus(id, activeLayerId, focusZoom);
  await api.updatePerson(id, { ...(updates as Record<string, unknown>), layer_id: activeLayerId });
  await fetchGraph();
};

export const updatePersonPositionAction = async (
  graphData: GraphData | null,
  id: string,
  position: { x: number; y: number },
  options?: { force?: boolean },
) => {
  if (!graphData) return;
  const person = graphData.nodes.find((entry) => entry.id === id);
  if (!person) return;
  const currentPosition = person.metadata?.position;
  if (!options?.force && currentPosition && currentPosition.x === position.x && currentPosition.y === position.y) {
    return;
  }

  try {
    const newMetadata = {
      ...(person.metadata || {}),
      position,
    };
    await api.updatePerson(id, { metadata: newMetadata, layer_id: graphData.layer_id });
  } catch (error) {
    console.error('Failed to update position:', error);
  }
};

export const createRelationshipAction = async (
  activeLayerId: string,
  from: string,
  to: string,
  refreshEdges: () => Promise<void>,
  refreshNodes: () => Promise<void>,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
  metadataOverride?: unknown,
): Promise<number[]> => {
  if (!activeLayerId) return [];
  try {
    const metadata = metadataOverride ?? ((sourceHandle || targetHandle) ? { sourceHandle, targetHandle } : undefined);
    const created = await api.createRelationship(from, to, activeLayerId, metadata, type);
    await Promise.all([refreshEdges(), refreshNodes()]);
    const rawIds = Array.isArray(created.created_relationship_ids) && created.created_relationship_ids.length
      ? created.created_relationship_ids
      : (typeof created.id === 'number' ? [created.id] : []);
    return Array.from(new Set(rawIds.filter((id) => Number.isFinite(id))));
  } catch (error) {
    console.error('Failed to create relationship:', error);
    return [];
  }
};

export const updateRelationshipAction = async (
  edgeId: string,
  updates: unknown,
  refreshEdges: () => Promise<void>,
  refreshNodes: () => Promise<void>,
) => {
  try {
    await api.updateRelationship(edgeId, updates as Record<string, unknown>);
    void refreshEdges();
    void refreshNodes();
  } catch (error) {
    console.error('Failed to update relationship:', error);
  }
};

export const reverseRelationshipAction = async (
  graphData: GraphData | null,
  edgeId: string,
  refreshEdges: () => Promise<void>,
  refreshNodes: () => Promise<void>,
) => {
  if (!graphData) return;
  const idNum = parseInt(edgeId.substring(1), 10);
  const edge = graphData.edges.find((entry) => entry.id === idNum);
  if (!edge) return;

  try {
    const oldSourceHandle = edge.metadata?.sourceHandle || '';
    const oldTargetHandle = edge.metadata?.targetHandle || '';
    const newSourceHandle = oldTargetHandle.replace('-t', '-s');
    const newTargetHandle = oldSourceHandle.replace('-s', '-t');
    const newMetadata = {
      ...edge.metadata,
      sourceHandle: newSourceHandle,
      targetHandle: newTargetHandle,
    };

    await api.updateRelationship(edgeId, {
      from_person_id: edge.to_person_id,
      to_person_id: edge.from_person_id,
      metadata: newMetadata,
    });
    void refreshEdges();
    void refreshNodes();
  } catch (error) {
    console.error('Failed to reverse relationship:', error);
  }
};

export const deleteRelationshipAction = async (
  edgeId: string,
  setGraphData: SetGraphData,
  refreshEdges: () => Promise<void>,
  refreshNodes: () => Promise<void>,
) => {
  try {
    await api.deleteRelationship(edgeId);
    setGraphData((prev) => {
      if (!prev) return prev;
      const nextEdges = prev.edges.filter((edge) => {
        const rawId = `e${edge.id}`;
        return edgeId !== rawId && edgeId !== String(edge.id);
      });
      return { ...prev, edges: nextEdges };
    });
    void refreshNodes();
  } catch (error) {
    console.error('Failed to delete relationship:', error);
    void refreshEdges();
  }
};

export const createPersonAction = async (
  activeLayerId: string,
  setGraphData: SetGraphData,
  fetchGraph: () => Promise<void>,
  input: {
    name: string;
    english_name?: string;
    gender: 'M' | 'F' | 'O';
    dob?: string;
    dod?: string;
    tob?: string;
    tod?: string;
    blood_type?: string;
    metadata?: unknown;
    id?: string;
    avatar_url?: string;
    options?: { skipFetch?: boolean };
  },
) => {
  if (!activeLayerId) {
    throw new Error('No active layer selected');
  }
  const person = await api.createPerson({
    ...input,
    layer_id: activeLayerId,
  });
  const normalizedPerson = {
    ...person,
    metadata: parseMetadata((person as Person & { metadata?: unknown }).metadata),
  } as typeof person;

  if (input.options?.skipFetch) {
    setGraphData((prev) => {
      if (!prev) {
        return { center: normalizedPerson.id, layer_id: activeLayerId, nodes: [normalizedPerson], edges: [] };
      }
      return { ...prev, nodes: [...prev.nodes, normalizedPerson] };
    });
    await refreshNodesAction(normalizedPerson.id, activeLayerId, setGraphData);
  } else {
    await fetchGraph();
  }
  return normalizedPerson;
};

export const deletePersonAction = async (
  id: string,
  activeLayerId: string,
  fetchGraph: () => Promise<void>,
  skipRefresh = false,
) => {
  await api.deletePerson(id, activeLayerId);
  if (!skipRefresh) {
    await fetchGraph();
  }
};
