import { useState, useCallback, useEffect, useMemo } from 'react';
import type { GraphData, GraphLayer } from '../types';
import {
  createLayerAction,
  createPersonAction,
  createRelationshipAction,
  deleteLayerAction,
  deletePersonAction,
  deleteRelationshipAction,
  fetchGraphAction,
  fetchLayersAction,
  loadLayerCenter,
  refreshEdgesAction,
  refreshNodesAction,
  reverseRelationshipAction,
  updatePersonAction,
  updatePersonPositionAction,
  updateRelationshipAction,
} from './clanGraph/actions';
import {
  persistActiveLayerId,
  persistCenterId,
  readStoredActiveLayerId,
} from './clanGraph/storage';

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

  const persistActiveLayer = useCallback((layerId: string) => {
    setActiveLayerIdState(layerId);
    persistActiveLayerId(layerId);
  }, []);

  const setCenterId = useCallback((id: string) => {
    setCenterIdState(id);
    if (!activeLayerId || !id) return;
    persistCenterId(activeLayerId, id);
  }, [activeLayerId]);

  const fetchLayers = useCallback(async () => {
    return fetchLayersAction(setLayers);
  }, []);

  const fetchGraph = useCallback(async () => {
    await fetchGraphAction(centerId, activeLayerId, enabled, setLoading, setError, setGraphData);
  }, [centerId, activeLayerId, enabled]);

  const refreshEdges = useCallback(async () => {
    await refreshEdgesAction(activeLayerId, setGraphData);
  }, [activeLayerId]);

  const refreshNodes = useCallback(async () => {
    await refreshNodesAction(centerId, activeLayerId, setGraphData);
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
        persistActiveLayer(preferredLayerId);
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
        await loadLayerCenter(activeLayer, activeLayerId, setCenterIdState, setError);
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
  }, [activeLayer, activeLayerId, enabled]);

  useEffect(() => {
    if (!centerId || !activeLayerId || !enabled) return;
    void fetchGraph();
  }, [fetchGraph, centerId, activeLayerId, enabled]);

  const setActiveLayerId = useCallback(async (layerId: string) => {
    persistActiveLayer(layerId);
    setGraphData(null);
    setCenterIdState('');
  }, [persistActiveLayer]);

  const createLayer = useCallback(async (name: string) => {
    return createLayerAction(name, fetchLayers, setActiveLayerIdState, setCenterIdState);
  }, [fetchLayers]);

  const deleteLayer = useCallback(async (layerId: string) => {
    return deleteLayerAction(layerId, activeLayerId, fetchLayers, setActiveLayerIdState, setCenterIdState, setGraphData);
  }, [activeLayerId, fetchLayers]);

  const updatePerson = useCallback(async (
    id: string,
    updates: any,
    options?: { focusZoom?: number }
  ) => {
    try {
      await updatePersonAction(id, updates, activeLayerId, fetchGraph, options);
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
    await updatePersonPositionAction(graphData, id, position, options);
  }, [graphData]);

  const createRelationship = useCallback(async (
    from: string,
    to: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
    type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
    metadataOverride?: any
  ): Promise<number[]> => {
    return createRelationshipAction(activeLayerId, from, to, refreshEdges, refreshNodes, sourceHandle, targetHandle, type, metadataOverride);
  }, [activeLayerId, refreshEdges, refreshNodes]);

  const updateRelationship = useCallback(async (edgeId: string, updates: any) => {
    await updateRelationshipAction(edgeId, updates, refreshEdges, refreshNodes);
  }, [refreshEdges, refreshNodes]);

  const reverseRelationship = useCallback(async (edgeId: string) => {
    await reverseRelationshipAction(graphData, edgeId, refreshEdges, refreshNodes);
  }, [graphData, refreshEdges, refreshNodes]);

  const deleteRelationship = useCallback(async (edgeId: string) => {
    await deleteRelationshipAction(edgeId, setGraphData, refreshEdges, refreshNodes);
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
    try {
      return await createPersonAction(activeLayerId, setGraphData, fetchGraph, {
        name,
        english_name,
        gender,
        dob,
        dod,
        tob,
        tod,
        blood_type,
        metadata,
        id,
        avatar_url,
        options,
      });
    } catch (error) {
      console.error('Failed to create person:', error);
      throw error;
    }
  };

  const deletePerson = useCallback(async (id: string, skipRefresh = false) => {
    try {
      await deletePersonAction(id, activeLayerId, fetchGraph, skipRefresh);
    } catch (error) {
      console.error('Failed to delete person:', error);
      throw error;
    }
  }, [activeLayerId, fetchGraph]);

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
