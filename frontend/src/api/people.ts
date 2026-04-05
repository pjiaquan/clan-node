import type { Avatar, Person, Relationship } from '../types';
import { API_BASE, fetchWithAuth } from './base';

export type CreateRelationshipResponse = Relationship & {
  created_relationship_ids?: number[];
};

export type PersonUpdates = Partial<Person> & { metadata?: unknown };

export type CreatePersonInput = {
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
  layer_id?: string;
};

const relationshipEdgeIdToDbId = (edgeId: string) => (
  edgeId.startsWith('e') ? edgeId.substring(1) : edgeId
);

export const peopleApi = {
  fetchPeople: async (layerId: string): Promise<Person[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people?layer=${encodeURIComponent(layerId)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const payload = await res.json();
    return Array.isArray(payload) ? payload : payload.people;
  },

  createPerson: async (input: CreatePersonInput): Promise<Person> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json();
  },

  updatePerson: async (id: string, updates: PersonUpdates & { layer_id?: string }): Promise<Person> => {
    const layerQuery = typeof updates.layer_id === 'string' && updates.layer_id
      ? `?layer=${encodeURIComponent(updates.layer_id)}`
      : '';
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}${layerQuery}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  },

  deletePerson: async (id: string, layerId: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/api/people/${id}?layer=${encodeURIComponent(layerId)}`, { method: 'DELETE' });
  },

  uploadAvatar: async (id: string, file: File): Promise<{ avatar_url: string }> => {
    const uploaded = await peopleApi.uploadPersonAvatar(id, file, { setPrimary: true });
    return { avatar_url: uploaded.avatar_url || '' };
  },

  fetchPersonAvatars: async (id: string, layerId: string): Promise<{ person_id: string; avatar_url: string | null; avatars: Avatar[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars?layer=${encodeURIComponent(layerId)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  uploadPersonAvatar: async (
    id: string,
    file: File,
    options?: { setPrimary?: boolean; layerId?: string },
  ): Promise<{ avatar_url: string | null; avatars: Avatar[]; avatar: Avatar | null }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.setPrimary !== undefined) {
      formData.append('set_primary', options.setPrimary ? '1' : '0');
    }
    const layerQuery = options?.layerId ? `?layer=${encodeURIComponent(options.layerId)}` : '';
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars${layerQuery}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  updatePersonAvatar: async (
    id: string,
    avatarId: string,
    updates: { is_primary?: boolean; sort_order?: number; layer_id?: string },
  ): Promise<{ avatar_url: string | null; avatars: Avatar[]; avatar: Avatar | null }> => {
    const layerQuery = updates.layer_id ? `?layer=${encodeURIComponent(updates.layer_id)}` : '';
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars/${avatarId}${layerQuery}`, {
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

  deletePersonAvatar: async (
    id: string,
    avatarId: string,
    layerId: string,
  ): Promise<{ success: boolean; avatar_id: string; avatar_url: string | null; avatars: Avatar[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars/${avatarId}?layer=${encodeURIComponent(layerId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  createRelationship: async (
    from: string,
    to: string,
    layerId: string,
    metadata?: unknown,
    type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
    skipAutoLink = false,
  ): Promise<CreateRelationshipResponse> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_person_id: from,
        to_person_id: to,
        layer_id: layerId,
        type,
        metadata,
        skipAutoLink,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  updateRelationship: async (
    edgeId: string,
    updates: { type?: string; from_person_id?: string; to_person_id?: string; metadata?: unknown },
  ): Promise<Relationship> => {
    const dbId = relationshipEdgeIdToDbId(edgeId);
    const res = await fetchWithAuth(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  },

  deleteRelationship: async (edgeId: string): Promise<void> => {
    const dbId = relationshipEdgeIdToDbId(edgeId);
    const res = await fetchWithAuth(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  },
};
