import type { KinshipLabel, RelationshipTypeKey, RelationshipTypeLabel } from '../types';
import { API_BASE, fetchWithAuth } from './base';

export const labelsApi = {
  fetchRelationshipTypeLabels: async (): Promise<RelationshipTypeLabel[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationship-type-labels`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  updateRelationshipTypeLabel: async (
    type: RelationshipTypeKey,
    updates: { label?: string; description?: string },
  ): Promise<RelationshipTypeLabel> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationship-type-labels/${type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  resetRelationshipTypeLabels: async (): Promise<{ items: RelationshipTypeLabel[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationship-type-labels/reset`, {
      method: 'POST',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  fetchKinshipLabels: async (): Promise<KinshipLabel[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/kinship-labels`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  updateKinshipLabel: async (payload: {
    default_title: string;
    default_formal_title: string;
    custom_title?: string | null;
    custom_formal_title?: string | null;
    description?: string;
  }): Promise<KinshipLabel> => {
    const res = await fetchWithAuth(`${API_BASE}/api/kinship-labels`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  resetKinshipLabels: async (): Promise<{ items: KinshipLabel[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/kinship-labels/reset`, {
      method: 'POST',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },
};
