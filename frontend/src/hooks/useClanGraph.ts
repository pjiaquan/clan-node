import { useState, useCallback, useEffect } from 'react';
import type { GraphData } from '../types';
import { api } from '../api';

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

export function useClanGraph(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const resolveInitialCenterId = () => {
    try {
      const storedCenter = localStorage.getItem('clan.centerId');
      if (storedCenter) return storedCenter;
    } catch {
      // Ignore localStorage errors and fall back to default initialization.
    }
    return '';
  };
  const [centerId, setCenterIdState] = useState<string>(() => resolveInitialCenterId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const centerStorageKey = 'clan.centerId';
  const defaultCenterId = '296f7664-ec3c-49c4-946c-4c54e8ce96e4';

  const setCenterId = useCallback((id: string) => {
    setCenterIdState(id);
    try {
      if (id) localStorage.setItem(centerStorageKey, id);
    } catch (err) {
      console.warn('Failed to persist centerId:', err);
    }
  }, []);

  const fetchGraph = useCallback(async () => {
    if (!centerId || !enabled) return;
    try {
      setLoading(true);
      setError(null);
      const data = await api.fetchGraph(centerId);
      setGraphData(data);
    } catch (err) {
      console.error('Failed to fetch graph:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [centerId, enabled]);

  const refreshEdges = useCallback(async () => {
    try {
      const relationships = await api.fetchRelationships();
      setGraphData((prev) => (prev ? { ...prev, edges: relationships } : prev));
    } catch (error) {
      console.error('Failed to refresh edges:', error);
    }
  }, []);

  const refreshNodes = useCallback(async () => {
    if (!centerId) return;
    try {
      const data = await api.fetchGraph(centerId);
      setGraphData((prev) => (prev ? { ...prev, nodes: data.nodes } : data));
    } catch (error) {
      console.error('Failed to refresh nodes:', error);
    }
  }, [centerId]);

  useEffect(() => {
    if (!centerId || !enabled) return;
    fetchGraph();
  }, [fetchGraph, centerId, enabled]);

  useEffect(() => {
    if (centerId || !enabled) return;
    let cancelled = false;
    const initCenter = async () => {
      try {
        setLoading(true);
        const storedCenter = localStorage.getItem(centerStorageKey);
        if (storedCenter) {
          if (!cancelled) setCenterIdState(storedCenter);
          return;
        }
        const people = await api.fetchPeople();
        if (!cancelled) {
          if (people.length) {
            const hasDefault = people.some((person) => person.id === defaultCenterId);
            setCenterId(hasDefault ? defaultCenterId : people[0].id);
          } else {
            setError('No people found');
            setLoading(false);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Unknown error');
          setLoading(false);
        }
      }
    };
    initCenter();
    return () => {
      cancelled = true;
    };
  }, [centerId, enabled, setCenterId]);

  const updatePerson = useCallback(async (
    id: string,
    updates: any,
    options?: { focusZoom?: number }
  ) => {
    try {
      const focusZoom = options?.focusZoom ?? 1.0;
      try {
        localStorage.setItem('clan.lastEditedId', id);
        localStorage.setItem('clan.pendingFocus', JSON.stringify({ id, zoom: focusZoom }));
      } catch (error) {
        console.warn('Failed to persist last edited id:', error);
      }
      await api.updatePerson(id, updates);
      await fetchGraph();
    } catch (error) {
      console.error('Failed to update person:', error);
      throw error;
    }
  }, [fetchGraph]);

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
    try {
      const metadata = metadataOverride ?? ((sourceHandle || targetHandle) ? { sourceHandle, targetHandle } : undefined);
      const created = await api.createRelationship(from, to, metadata, type);
      await Promise.all([refreshEdges(), refreshNodes()]);
      const rawIds = Array.isArray(created.created_relationship_ids) && created.created_relationship_ids.length
        ? created.created_relationship_ids
        : (typeof created.id === 'number' ? [created.id] : []);
      return Array.from(new Set(rawIds.filter((id) => Number.isFinite(id))));
    } catch (error) {
      console.error('Failed to create relationship:', error);
      return [];
    }
  }, [refreshEdges, refreshNodes]);

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

      // Convert old target handle (e.g. 'bottom-t') to new source handle ('bottom-s')
      const newSourceHandle = oldTargetHandle.replace('-t', '-s');
      
      // Convert old source handle (e.g. 'top-s') to new target handle ('top-t')
      const newTargetHandle = oldSourceHandle.replace('-s', '-t');

      const newMetadata = {
        ...edge.metadata,
        sourceHandle: newSourceHandle,
        targetHandle: newTargetHandle
      };

      await api.updateRelationship(edgeId, {
        from_person_id: edge.to_person_id,
        to_person_id: edge.from_person_id,
        metadata: newMetadata // Send updated metadata
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
    try {
      const person = await api.createPerson(name, english_name, gender, dob, dod, tob, tod, blood_type, metadata, id, avatar_url);
      const normalizedPerson = {
        ...person,
        metadata: parseMetadata((person as any).metadata),
      } as typeof person;
      if (options?.skipFetch) {
        setGraphData((prev) => {
          if (!prev) {
            return { center: normalizedPerson.id, nodes: [normalizedPerson], edges: [] };
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
    deletePerson
  };
}
