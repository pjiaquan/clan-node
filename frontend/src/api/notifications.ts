import type { NotificationItem, NotificationStats, NotificationStatus, NotificationType } from '../types';
import { API_BASE, fetchWithAuth } from './base';

export const notificationsApi = {
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
    updates: { status: NotificationStatus },
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
};
