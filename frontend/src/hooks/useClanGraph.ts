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
  const [centerId, setCenterIdState] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const centerStorageKey = 'clan.centerId';

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
      console.log('Fetching graph for center:', centerId);
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
            setCenterId(people[0].id);
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

  const updatePerson = useCallback(async (id: string, updates: any) => {
    try {
      await api.updatePerson(id, updates);
      fetchGraph();
    } catch (error) {
      console.error('Failed to update person:', error);
    }
  }, [fetchGraph]);

  const updatePersonPosition = useCallback(async (id: string, position: { x: number; y: number }) => {
    if (!graphData) return;
    const person = graphData.nodes.find(p => p.id === id);
    if (!person) return;

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
    type: 'parent_child' | 'spouse' | 'sibling' | 'in_law' = 'parent_child',
    metadataOverride?: any
  ) => {
    try {
      const metadata = metadataOverride ?? ((sourceHandle || targetHandle) ? { sourceHandle, targetHandle } : undefined);
      await api.createRelationship(from, to, metadata, type);
      refreshEdges();
    } catch (error) {
      console.error('Failed to create relationship:', error);
    }
  }, [refreshEdges]);

  const updateRelationship = useCallback(async (edgeId: string, updates: any) => {
    try {
      await api.updateRelationship(edgeId, updates);
      refreshEdges();
    } catch (error) {
      console.error('Failed to update relationship:', error);
    }
  }, [refreshEdges]);

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
    } catch (error) {
      console.error('Failed to reverse relationship:', error);
    }
  }, [graphData, refreshEdges]);

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
    } catch (error) {
      console.error('Failed to delete relationship:', error);
      refreshEdges();
    }
  }, [refreshEdges]);

  const createPerson = async (
    name: string,
    english_name: string | undefined,
    gender: 'M' | 'F' | 'O',
    dob?: string,
    dod?: string,
    tob?: string,
    tod?: string,
    metadata?: any,
    id?: string,
    avatar_url?: string,
    options?: { skipFetch?: boolean }
  ) => {
    try {
      const person = await api.createPerson(name, english_name, gender, dob, dod, tob, tod, metadata, id, avatar_url);
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
