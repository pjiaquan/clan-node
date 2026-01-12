import type { GraphData, Person, Relationship } from './types';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

const resolveAvatarUrl = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  return `${API_BASE}${avatarUrl}`;
};

const fetchWithAuth = (input: RequestInfo | URL, init: RequestInit = {}) => {
  return fetch(input, { credentials: 'include', ...init });
};

export const api = {
  resolveAvatarUrl,
  fetchAvatarBlobUrl: async (avatarUrl: string): Promise<string> => {
    const resolved = resolveAvatarUrl(avatarUrl);
    if (!resolved) {
      throw new Error('Invalid avatar URL');
    }
    const res = await fetchWithAuth(resolved);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  fetchGraph: async (centerId: string): Promise<GraphData> => {
    const res = await fetchWithAuth(`${API_BASE}/api/graph?center=${centerId}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },
  fetchRelationships: async (): Promise<Relationship[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationships`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  fetchPeople: async (): Promise<Person[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  createPerson: async (name: string, english_name: string | undefined, gender: 'M' | 'F' | 'O', dob?: string, dod?: string, tob?: string, tod?: string, metadata?: any, id?: string, avatar_url?: string): Promise<Person> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, english_name, gender, dob, dod, tob, tod, avatar_url, metadata }),
    });
    return res.json();
  },

  updatePerson: async (id: string, updates: Partial<Person> & { metadata?: any }): Promise<Person> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  },

  uploadAvatar: async (id: string, file: File): Promise<{ avatar_url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatar`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  createRelationship: async (
    from: string,
    to: string,
    metadata?: any,
    type: 'parent_child' | 'spouse' | 'sibling' | 'in_law' = 'parent_child',
    skipAutoLink = false
  ): Promise<Relationship> => {
    const res = await fetchWithAuth(`${API_BASE}/api/relationships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_person_id: from,
        to_person_id: to,
        type,
        metadata,
        skipAutoLink,
      }),
    });
    return res.json();
  },

  updateRelationship: async (edgeId: string, updates: { type?: string; from_person_id?: string; to_person_id?: string; metadata?: any }): Promise<Relationship> => {
    const dbId = edgeId.substring(1);
    const res = await fetchWithAuth(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    return res.json();
  },

  deleteRelationship: async (edgeId: string): Promise<void> => {
    const dbId = edgeId.startsWith('e') ? edgeId.substring(1) : edgeId;
    const res = await fetchWithAuth(`${API_BASE}/api/relationships/${dbId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  },

  deletePerson: async (id: string): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/api/people/${id}`, {
      method: 'DELETE',
    });
  },

  authMe: async (): Promise<{ user: { id: string; username: string } }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/me`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  login: async (username: string, password: string): Promise<{ user: { id: string; username: string } }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  logout: async (): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  },
};
