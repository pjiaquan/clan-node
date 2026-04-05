import type { AuditLogItem, NodeBackupPayload } from '../types';
import { API_BASE, fetchWithAuth } from './base';

export const adminApi = {
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
      body: JSON.stringify({
        confirmation_text: 'DELETE',
        data: payload,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  },
};
