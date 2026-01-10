import { useState, useCallback, useEffect } from 'react';
import type { GraphData } from '../types';
import { api } from '../api';

export function useClanGraph() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [centerId, setCenterId] = useState<string>('1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
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
  }, [centerId]);

  useEffect(() => {
    fetchGraph();
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
      await api.updatePersonPosition(id, newMetadata);
    } catch (error) {
      console.error('Failed to update position:', error);
    }
  }, [graphData]);

  const createRelationship = useCallback(async (
    from: string, 
    to: string, 
    sourceHandle?: string | null, 
    targetHandle?: string | null
  ) => {
    try {
      const metadata = (sourceHandle || targetHandle) ? { sourceHandle, targetHandle } : undefined;
      await api.createRelationship(from, to, metadata);
      fetchGraph();
    } catch (error) {
      console.error('Failed to create relationship:', error);
    }
  }, [fetchGraph]);

  const updateRelationshipType = useCallback(async (edgeId: string, type: 'parent_child' | 'spouse') => {
    try {
      await api.updateRelationship(edgeId, type);
      fetchGraph();
    } catch (error) {
      console.error('Failed to update relationship:', error);
    }
  }, [fetchGraph]);

  const deleteRelationship = useCallback(async (edgeId: string) => {
    try {
      await api.deleteRelationship(edgeId);
      fetchGraph();
    } catch (error) {
      console.error('Failed to delete relationship:', error);
    }
  }, [fetchGraph]);

  const createPerson = async (name: string, gender: 'M' | 'F' | 'O') => {
    try {
      const person = await api.createPerson(name, gender);
      fetchGraph();
      return person;
    } catch (error) {
      console.error('Failed to create person:', error);
      throw error;
    }
  };

  return {
    graphData,
    centerId,
    setCenterId,
    loading,
    error,
    fetchGraph,
    updatePersonPosition,
    createRelationship,
    updateRelationshipType,
    deleteRelationship,
    createPerson
  };
}
