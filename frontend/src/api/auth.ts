import type {
  AcceptInviteResult,
  AccountProfile,
  AuthSession,
  AuthUser,
  ManagedUser,
  MfaStatus,
  PendingMfaChallenge,
  UserInviteResult,
} from '../types';
import { API_BASE, fetchWithAuth, parseErrorMessage } from './base';

export type LoginResponse =
  | { user: AuthUser; mfa_required?: false }
  | ({ mfa_required: true } & PendingMfaChallenge);

export const authApi = {
  authMe: async (): Promise<{ user: AuthUser }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/me`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  },

  fetchAccount: async (): Promise<AccountProfile> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/account`);
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  updateAccount: async (updates: { email?: string; avatar_url?: string | null }): Promise<AccountProfile> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/account`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  uploadAccountAvatar: async (file: File): Promise<AccountProfile> => {
    const formData = new FormData();
    formData.set('file', file);
    const res = await fetchWithAuth(`${API_BASE}/api/auth/account/avatar`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  changeOwnPassword: async (currentPassword: string, newPassword: string): Promise<{ ok: boolean; revoked_other_sessions: number }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/account/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  forgotPassword: async (email: string): Promise<{ ok: boolean }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  resetPassword: async (token: string, password: string): Promise<{ ok: boolean }> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
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

  resendVerification: async (email: string): Promise<{ ok: boolean; delivered?: boolean; debug_verify_token?: string; debug_invite_token?: string }> => {
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

  acceptInvite: async (token: string, password: string): Promise<AcceptInviteResult> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/accept-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (!res.ok) {
      throw new Error(await parseErrorMessage(res));
    }
    return res.json();
  },

  logout: async (): Promise<void> => {
    await fetchWithAuth(`${API_BASE}/api/auth/logout`, { method: 'POST' });
  },

  createUser: async (email: string, role: 'admin' | 'readonly'): Promise<UserInviteResult> => {
    const res = await fetchWithAuth(`${API_BASE}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
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

  updateUser: async (id: string, updates: { role?: 'admin' | 'readonly'; password?: string }): Promise<ManagedUser> => {
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
};
