export interface Person {
  id: string;
  name: string;
  english_name?: string | null;
  gender: 'M' | 'F' | 'O';
  dob?: string | null;
  dod?: string | null;
  tob?: string | null;
  tod?: string | null;
  avatar_url?: string | null;
  title?: string;
  formal_title?: string;
  metadata?: {
    position?: { x: number; y: number };
    customFields?: { label: string; value: string }[];
    avatarHash?: string;
    [key: string]: any;
  } | null;
}

export interface Relationship {
  id: number;
  from_person_id: string;
  to_person_id: string;
  type: string;
  metadata?: {
    sourceHandle?: string;
    targetHandle?: string;
    [key: string]: any;
  } | null;
}

export interface GraphData {
  center: string;
  nodes: Person[];
  edges: Relationship[];
}

export type UserRole = 'admin' | 'readonly';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface ManagedUser {
  id: string;
  username: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  browser: string;
  platform: string;
  device_label: string;
  current: boolean;
}

export type NotificationType = 'rename' | 'avatar' | 'relationship' | 'other';
export type NotificationStatus = 'pending' | 'in_progress' | 'resolved' | 'rejected';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  target_person_id: string | null;
  target_person_name: string | null;
  message: string;
  status: NotificationStatus;
  created_by_user_id: string;
  created_by_username: string;
  resolved_by_user_id: string | null;
  resolved_by_username: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationStats {
  total: number;
  pending: number;
  in_progress: number;
  resolved: number;
  rejected: number;
  unresolved: number;
}
