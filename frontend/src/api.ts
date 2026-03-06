import type {
  Avatar,
  AuditLogItem,
  AuthSession,
  AuthUser,
  GraphData,
  KinshipLabel,
  ManagedUser,
  MfaStatus,
  PendingMfaChallenge,
  NotificationItem,
  NotificationStats,
  NotificationStatus,
  NotificationType,
  NodeBackupPayload,
  Person,
  Relationship,
  RelationshipTypeKey,
  RelationshipTypeLabel
} from './types';

export type CreateRelationshipResponse = Relationship & {
  created_relationship_ids?: number[];
};

export type LoginResponse =
  | { user: AuthUser; mfa_required?: false }
  | ({ mfa_required: true } & PendingMfaChallenge);

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
const normalizeApiBase = (value: string) => {
  let next = value.trim().replace(/\/+$/, '');
  if (next.endsWith('/api')) {
    next = next.slice(0, -4);
  }
  return next;
};
const API_BASE = normalizeApiBase(
  import.meta.env.VITE_API_BASE
    || (isLocalhost ? `${window.location.protocol}//${window.location.hostname}:8787` : 'https://clan-node.pjiaquan.workers.dev')
);

const resolveAvatarUrl = (avatarUrl: string | null | undefined) => {
  if (!avatarUrl) return null;
  if (/^https?:\/\//i.test(avatarUrl)) return avatarUrl;
  return `${API_BASE}${avatarUrl}`;
};

const fetchWithAuth = (input: RequestInfo | URL, init: RequestInit = {}) => (
  fetch(input, { credentials: 'include', ...init }).then((res) => {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('clan:unauthorized'));
    }
    return res;
  })
);

const parseErrorMessage = async (res: Response): Promise<string> => {
  try {
    const data = await res.clone().json();
    if (typeof (data as any)?.error === 'string' && (data as any).error.trim()) {
      return (data as any).error.trim();
    }
  } catch {
    // fall through to text parser
  }
  try {
    const text = (await res.text()).trim();
    if (text) return text;
  } catch {
    // ignore
  }
  return `HTTP ${res.status}: ${res.statusText}`;
};

export const api = {
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

  createPerson: async (
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
    avatar_url?: string
  ): Promise<Person> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, english_name, gender, dob, dod, tob, tod, blood_type, avatar_url, metadata }),
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
    const uploaded = await api.uploadPersonAvatar(id, file, { setPrimary: true });
    return { avatar_url: uploaded.avatar_url || '' };
  },

  fetchPersonAvatars: async (id: string): Promise<{ person_id: string; avatar_url: string | null; avatars: Avatar[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  uploadPersonAvatar: async (
    id: string,
    file: File,
    options?: { setPrimary?: boolean }
  ): Promise<{ avatar_url: string | null; avatars: Avatar[]; avatar: Avatar | null }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.setPrimary !== undefined) {
      formData.append('set_primary', options.setPrimary ? '1' : '0');
    }
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars`, {
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
    updates: { is_primary?: boolean; sort_order?: number }
  ): Promise<{ avatar_url: string | null; avatars: Avatar[]; avatar: Avatar | null }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars/${avatarId}`, {
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
    avatarId: string
  ): Promise<{ success: boolean; avatar_id: string; avatar_url: string | null; avatars: Avatar[] }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/people/${id}/avatars/${avatarId}`, {
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
    metadata?: any,
    type: 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law' = 'parent_child',
    skipAutoLink = false
  ): Promise<CreateRelationshipResponse> => {
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
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
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

  authMe: async (): Promise<{ user: AuthUser }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/me`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  getSetupStatus: async (): Promise<{ requires_setup: boolean }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/setup`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  setupAdmin: async (email: string, password: string): Promise<{ id: string; email: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  login: async (email: string, password: string): Promise<LoginResponse> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  verifyMfa: async (challengeId: string, code: string): Promise<{ user: AuthUser }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/verify-mfa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  verifyTotpMfa: async (sessionId: string, code: string): Promise<{ user: AuthUser }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/mfa/verify-totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, code }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  sendEmailMfaCode: async (sessionId: string): Promise<{ ok: boolean; challenge_id: string; delivered?: boolean; debug_mfa_code?: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/mfa/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  fetchMfaStatus: async (): Promise<MfaStatus> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/mfa/status`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  startTotpSetup: async (): Promise<{ secret: string; otpauth_url: string; expires_at: string; email: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/mfa/totp/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  confirmTotpSetup: async (code: string): Promise<{ ok: boolean; enabled_at: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/mfa/totp/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  verifyEmail: async (token: string): Promise<{ ok: boolean; email?: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  resendVerification: async (email: string): Promise<{ ok: boolean; delivered?: boolean; debug_verify_token?: string }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  logout: async (): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  },

  createUser: async (email: string, password: string, role: 'admin' | 'readonly'): Promise<AuthUser> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  fetchUsers: async (): Promise<ManagedUser[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/users`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  updateUser: async (
    id: string,
    updates: { role?: 'admin' | 'readonly'; password?: string }
  ): Promise<ManagedUser> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/users/${id}`, {
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

  deleteUser: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/users/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  },

  fetchSessions: async (): Promise<AuthSession[]> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/sessions`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  revokeSession: async (id: string): Promise<{ ok: boolean; current: boolean }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/sessions/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  revokeOtherSessions: async (): Promise<{ ok: boolean; deleted: number }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/sessions/revoke-others`, {
      method: 'POST',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  createNotification: async (payload: {
    type: NotificationType;
    target_person_id?: string | null;
    target_person_name?: string | null;
    message: string;
  }): Promise<NotificationItem> => {
    const res = await fetchWithAuth(`${API_BASE}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  fetchNotifications: async (status?: NotificationStatus): Promise<NotificationItem[]> => {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetchWithAuth(`${API_BASE}/api/notifications${query}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  updateNotification: async (
    id: string,
    updates: { status: NotificationStatus }
  ): Promise<NotificationItem> => {
    const res = await fetchWithAuth(`${API_BASE}/api/notifications/${id}`, {
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

  deleteNotification: async (id: string): Promise<void> => {
    const res = await fetchWithAuth(`${API_BASE}/api/notifications/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  },

  fetchNotificationStats: async (): Promise<NotificationStats> => {
    const res = await fetchWithAuth(`${API_BASE}/api/notifications/stats`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

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
    updates: { label?: string; description?: string }
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

  fetchAuditLogs: async (limit = 200): Promise<AuditLogItem[]> => {
    const finalLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 500)) : 200;
    const res = await fetchWithAuth(`${API_BASE}/api/audit-logs?limit=${finalLimit}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  exportNodeBackup: async (): Promise<NodeBackupPayload> => {
    const res = await fetchWithAuth(`${API_BASE}/api/admin/backup/export`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },

  importNodeBackup: async (payload: NodeBackupPayload | Record<string, unknown>): Promise<{
    success: boolean;
    version: number;
    counts: Record<string, number>;
  }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/admin/backup/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },
};
