import type { GraphData, GraphLayer, Relationship } from '../types';
import { API_BASE, fetchWithAuth, parseErrorMessage, resolveAvatarUrl } from './base';

export const graphApi = {
  resolveAvatarUrl,

  fetchAvatarBlobUrl: async (avatarUrl: string): Promise<string | null> => {
    const resolved = resolveAvatarUrl(avatarUrl);
    if (!resolved) {
      throw new Error('Invalid avatar URL');
    }
    const res = await fetchWithAuth(resolved);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  fetchLayers: async (): Promise<GraphLayer[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/layers`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json() as { layers: GraphLayer[] };
    return data.layers || [];
  },

  createLayer: async (name: string, description?: string | null): Promise<{ layer: GraphLayer; center_id: string | null }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/layers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  deleteLayer: async (id: string): Promise<{ success: boolean; id: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/layers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  fetchGraph: async (centerId: string, layerId: string): Promise<GraphData> => {
    const res = await fetchWithAuth(`${API_BASE}/api/graph?center=${encodeURIComponent(centerId)}&layer=${encodeURIComponent(layerId)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  fetchRelationships: async (layerId: string): Promise<Relationship[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationships?layer=${encodeURIComponent(layerId)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },
};
