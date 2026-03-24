import { useState, useCallback, useEffect, useMemo } from 'react';
import type { GraphData, GraphLayer } from '../types';
import { api } from '../api';

const ACTIVE_LAYER_STORAGE_KEY = 'clan.layer.active';
const defaultCenterId = '296f7664-ec3c-49c4-946c-4c54e8ce96e4';

const parseMetadata = (value: any) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const readStoredActiveLayerId = () => {
  try {
    return localStorage.getItem(ACTIVE_LAYER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const getCenterStorageKey = (layerId: string) => `clan.centerId.${layerId}`;
const clearStoredLayerState = (layerId: string) => {
  try {
    localStorage.removeItem(getCenterStorageKey(layerId));
  } catch (error) {
    console.warn('Failed to clear stored layer state:', error);
  }
};

const queueLayerFocus = (layerId: string, centerId: string, zoom = 1) => {
  try {
    localStorage.setItem('clan.pendingFocus', JSON.stringify({
      id: centerId,
      zoom,
      layerId,
    }));
    localStorage.removeItem('clan.pendingFocusPosition');
    localStorage.removeItem('clan.pendingCenterId');
  } catch (error) {
    console.warn('Failed to queue layer focus:', error);
  }
};

export function useClanGraph(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [layers, setLayers] = useState<GraphLayer[]>([]);
  const [activeLayerId, setActiveLayerIdState] = useState<string>(() => readStoredActiveLayerId());
  const [centerId, setCenterIdState] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeLayer = useMemo(
    () => layers.find((layer) => layer.id === activeLayerId) ?? null,
    [layers, activeLayerId]
  );

  const persistActiveLayerId = useCallback((layerId: string) => {
    setActiveLayerIdState(layerId);
    try {
      if (layerId) localStorage.setItem(ACTIVE_LAYER_STORAGE_KEY, layerId);
    } catch (err) {
      console.warn('Failed to persist active layer id:', err);
    }
  }, []);

  const setCenterId = useCallback((id: string) => {
    setCenterIdState(id);
    if (!activeLayerId || !id) return;
    try {
      localStorage.setItem(getCenterStorageKey(activeLayerId), id);
    } catch (err) {
      console.warn('Failed to persist centerId:', err);
    }
  }, [activeLayerId]);

  const loadLayerCenter = useCallback(async (layerId: string) => {
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

    const people = await api.fetchPeople(layerId);
    if (people.length) {
      const hasDefault = people.some((person) => person.id === defaultCenterId);
      const nextCenterId = hasDefault ? defaultCenterId : people[0].id;
      setCenterIdState(nextCenterId);
      try {
        localStorage.setItem(getCenterStorageKey(layerId), nextCenterId);
      } catch (error) {
        console.warn('Failed to persist initialized centerId:', error);
      }
      queueLayerFocus(layerId, nextCenterId);
      return;
    }

    setCenterIdState('');
    setError('No people found');
  }, []);

  const fetchLayers = useCallback(async () => {
    const items = await api.fetchLayers();
    setLayers(items);
    return items;
  }, []);

  const fetchGraph = useCallback(async () => {
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
  }, [centerId, activeLayerId, enabled]);

  const refreshEdges = useCallback(async () => {
    if (!activeLayerId) return;
    try {
      const relationships = await api.fetchRelationships(activeLayerId);
      setGraphData((prev) => (prev ? { ...prev, edges: relationships } : prev));
    } catch (error) {
      console.error('Failed to refresh edges:', error);
    }
  }, [activeLayerId]);

  const refreshNodes = useCallback(async () => {
    if (!centerId || !activeLayerId) return;
    try {
      const data = await api.fetchGraph(centerId, activeLayerId);
      setGraphData((prev) => (prev ? { ...prev, nodes: data.nodes } : data));
    } catch (error) {
      console.error('Failed to refresh nodes:', error);
    }
  }, [centerId, activeLayerId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const initLayers = async () => {
      try {
        setLoading(true);
        const items = await fetchLayers();
        if (cancelled) return;
        if (!items.length) {
          setError('No layers found');
          setLoading(false);
          return;
        }
        const preferredLayerId = items.some((layer) => layer.id === activeLayerId)
          ? activeLayerId
          : items[0].id;
        persistActiveLayerId(preferredLayerId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error');
          setLoading(false);
        }
      }
    };
    void initLayers();
    return () => {
      cancelled = true;
    };
  }, [activeLayerId, enabled, fetchLayers, persistActiveLayerId]);

  useEffect(() => {
    if (!activeLayerId || !enabled) return;
    let cancelled = false;
    const initCenter = async () => {
      try {
        setError(null);
        await loadLayerCenter(activeLayerId);
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Unknown error');
          setLoading(false);
        }
      }
    };
    void initCenter();
    return () => {
      cancelled = true;
    };
  }, [activeLayerId, enabled, loadLayerCenter]);

  useEffect(() => {
    if (!centerId || !activeLayerId || !enabled) return;
    void fetchGraph();
  }, [fetchGraph, centerId, activeLayerId, enabled]);

  const setActiveLayerId = useCallback(async (layerId: string) => {
    persistActiveLayerId(layerId);
    setGraphData(null);
    setCenterIdState('');
  }, [persistActiveLayerId]);

  const createLayer = useCallback(async (name: string) => {
    const created = await api.createLayer(name);
    const updatedLayers = await fetchLayers();
    const nextLayerId = created.layer.id || updatedLayers[0]?.id || '';
    if (nextLayerId) {
      persistActiveLayerId(nextLayerId);
      if (created.center_id) {
        setCenterIdState(created.center_id);
        try {
          localStorage.setItem(getCenterStorageKey(nextLayerId), created.center_id);
        } catch (error) {
          console.warn('Failed to persist new layer centerId:', error);
        }
        queueLayerFocus(nextLayerId, created.center_id);
      }
    }
    return created;
  }, [fetchLayers, persistActiveLayerId]);

  const deleteLayer = useCallback(async (layerId: string) => {
    await api.deleteLayer(layerId);
    clearStoredLayerState(layerId);

    const updatedLayers = await fetchLayers();
    const nextLayerId = updatedLayers.find((layer) => layer.id !== layerId)?.id || updatedLayers[0]?.id || '';

    if (activeLayerId === layerId) {
      if (nextLayerId) {
        persistActiveLayerId(nextLayerId);
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
  }, [activeLayerId, fetchLayers, persistActiveLayerId]);

  const updatePerson = useCallback(async (
    id: string,
    updates: any,
    options?: { focusZoom?: number }
  ) => {
    try {
      const focusZoom = options?.focusZoom ?? 1.0;
      try {
        localStorage.setItem('clan.lastEditedId', id);
        localStorage.setItem('clan.pendingFocus', JSON.stringify({ id, zoom: focusZoom, layerId: activeLayerId }));
      } catch (error) {
        console.warn('Failed to persist last edited id:', error);
      }
      await api.updatePerson(id, updates);
      await fetchGraph();
    } catch (error) {
      console.error('Failed to update person:', error);
      throw error;
    }
  }, [activeLayerId, fetchGraph]);

  const updatePersonPosition = useCallback(async (
    id: string,
    position: { x: number; y: number },
    options?: { force?: boolean }
  ) => {
    if (!graphData) return;
    const person = graphData.nodes.find(p => p.id === id);
    if (!person) return;
    const currentPosition = person.metadata?.position;
    if (!options?.force && currentPosition
      && currentPosition.x === position.x
      && currentPosition.y === position.y) {
      return;
    }

    try {
      const newMetadata = {
        ...(person.metadata || {}),
        position
      };
      await api.updatePerson(id, { metadata: newMetadata });
    } catch (error) {
      console.error('Failed to update position:', error);
    }
  }, [graphData]);

  const createRelationship = useCallback(async (
    from: string,
    to: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
    type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
    metadataOverride?: any
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
  }, [activeLayerId, refreshEdges, refreshNodes]);

  const updateRelationship = useCallback(async (edgeId: string, updates: any) => {
    try {
      await api.updateRelationship(edgeId, updates);
      refreshEdges();
      refreshNodes();
    } catch (error) {
      console.error('Failed to update relationship:', error);
    }
  }, [refreshEdges, refreshNodes]);

  const reverseRelationship = useCallback(async (edgeId: string) => {
    if (!graphData) return;
    const idNum = parseInt(edgeId.substring(1));
    const edge = graphData.edges.find(e => e.id === idNum);
    if (!edge) return;

    try {
      const oldSourceHandle = edge.metadata?.sourceHandle || '';
      const oldTargetHandle = edge.metadata?.targetHandle || '';
      const newSourceHandle = oldTargetHandle.replace('-t', '-s');
      const newTargetHandle = oldSourceHandle.replace('-s', '-t');
      const newMetadata = {
        ...edge.metadata,
        sourceHandle: newSourceHandle,
        targetHandle: newTargetHandle
      };

      await api.updateRelationship(edgeId, {
        from_person_id: edge.to_person_id,
        to_person_id: edge.from_person_id,
        metadata: newMetadata
      });
      refreshEdges();
      refreshNodes();
    } catch (error) {
      console.error('Failed to reverse relationship:', error);
    }
  }, [graphData, refreshEdges, refreshNodes]);

  const deleteRelationship = useCallback(async (edgeId: string) => {
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
      refreshNodes();
    } catch (error) {
      console.error('Failed to delete relationship:', error);
      refreshEdges();
    }
  }, [refreshEdges, refreshNodes]);

  const createPerson = async (
    name: string,
    english_name: string | undefined,
    gender: 'M' | 'F' | 'O',
    dob?: string,
    dod?: string,
    tob?: string,
    tod?: string,
    blood_type?: string,
    metadata?: any,
    id?: string,
    avatar_url?: string,
    options?: { skipFetch?: boolean }
  ) => {
    if (!activeLayerId) {
      throw new Error('No active layer selected');
    }
    try {
      const person = await api.createPerson(name, english_name, gender, dob, dod, tob, tod, blood_type, metadata, id, avatar_url, activeLayerId);
      const normalizedPerson = {
        ...person,
        metadata: parseMetadata((person as any).metadata),
      } as typeof person;
      if (options?.skipFetch) {
        setGraphData((prev) => {
          if (!prev) {
            return { center: normalizedPerson.id, layer_id: activeLayerId, nodes: [normalizedPerson], edges: [] };
          }
          return { ...prev, nodes: [...prev.nodes, normalizedPerson] };
        });
        refreshNodes();
      } else {
        fetchGraph();
      }
      return normalizedPerson;
    } catch (error) {
      console.error('Failed to create person:', error);
      throw error;
    }
  };

  const deletePerson = useCallback(async (id: string, skipRefresh = false) => {
    try {
      await api.deletePerson(id);
      if (!skipRefresh) {
        fetchGraph();
      }
    } catch (error) {
      console.error('Failed to delete person:', error);
      throw error;
    }
  }, [fetchGraph]);

  return {
    graphData,
    centerId,
    setCenterId,
    loading,
    error,
    fetchGraph,
    updatePersonPosition,
    updatePerson,
    createRelationship,
    updateRelationship,
    reverseRelationship,
    deleteRelationship,
    refreshEdges,
    createPerson,
    deletePerson,
    layers,
    activeLayer,
    activeLayerId,
    setActiveLayerId,
    createLayer,
    deleteLayer,
  };
}
