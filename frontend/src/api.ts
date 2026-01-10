import type { GraphData, Person, Relationship } from './types';

const API_BASE = 'http://localhost:8787';

export const api = {
  fetchGraph: async (centerId: string): Promise<GraphData> => {
    const res = await fetch(`${API_BASE}/api/graph?center=${centerId}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  createPerson: async (name: string, gender: 'M' | 'F' | 'O'): Promise<Person> => {
    const res = await fetch(`${API_BASE}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, gender }),
    });
    return res.json();
  },

  updatePersonPosition: async (id: string, metadata: any): Promise<Person> => {
    const res = await fetch(`${API_BASE}/api/people/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata }),
    });
    return res.json();
  },

  createRelationship: async (
    from: string,
    to: string,
    metadata?: any
  ): Promise<Relationship> => {
    const res = await fetch(`${API_BASE}/api/relationships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_person_id: from,
        to_person_id: to,
        type: 'parent_child', // Default
        metadata,
      }),
    });
    return res.json();
  },

  updateRelationship: async (edgeId: string, type: 'parent_child' | 'spouse'): Promise<Relationship> => {
    const dbId = edgeId.substring(1);
    const res = await fetch(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    return res.json();
  },

  deleteRelationship: async (edgeId: string): Promise<void> => {
    const dbId = edgeId.substring(1);
    await fetch(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'DELETE',
    });
  },
};
