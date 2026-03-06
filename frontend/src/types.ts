export interface Avatar {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key?: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Person {
  id: string;
  name: string;
  english_name?: string | null;
  gender: 'M' | 'F' | 'O';
  blood_type?: string | null;
  dob?: string | null;
  dod?: string | null;
  tob?: string | null;
  tod?: string | null;
  avatar_url?: string | null;
  avatars?: Avatar[];
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

export type RelationshipTypeKey = 'parent_child' | 'spouse' | 'ex_spouse' | 'sibling' | 'in_law';

export interface RelationshipTypeLabel {
  type: RelationshipTypeKey;
  label: string;
  description: string;
  default_label: string;
  default_description: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface KinshipLabel {
  default_title: string;
  default_formal_title: string;
  custom_title: string | null;
  custom_formal_title: string | null;
  description: string;
  created_at: string | null;
  updated_at: string | null;
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
  email?: string;
  role: UserRole;
}

export interface ManagedUser {
  id: string;
  username: string;
  email?: string;
  email_verified_at?: string | null;
  first_login_at?: string | null;
  latest_login_at?: string | null;
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

export interface AuditLogItem {
  id: number;
  actor_user_id: string | null;
  actor_username: string | null;
  actor_role: UserRole | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface NodeBackupPayload {
  version: number;
  exported_at: string;
  exported_by?: string | null;
  people: Array<{
    id: string;
    name: string;
    english_name: string | null;
    gender: 'M' | 'F' | 'O';
    blood_type: string | null;
    dob: string | null;
    dod: string | null;
    tob: string | null;
    tod: string | null;
    avatar_url: string | null;
    metadata: string | null;
    created_at: string | null;
    updated_at: string | null;
  }>;
  person_avatars: Array<{
    id: string;
    person_id: string;
    avatar_url: string;
    storage_key: string | null;
    is_primary: boolean;
    sort_order: number;
    created_at: string | null;
    updated_at: string | null;
  }>;
  relationships: Array<{
    id: number | null;
    from_person_id: string;
    to_person_id: string;
    type: string;
    metadata: string | null;
    created_at: string | null;
  }>;
  person_custom_fields: Array<{
    id: number | null;
    person_id: string;
    label: string;
    value: string;
    created_at: string | null;
    updated_at: string | null;
  }>;
  relationship_type_labels?: Array<{
    type: string;
    label: string;
    description: string;
    created_at: string | null;
    updated_at: string | null;
  }>;
  kinship_labels?: Array<{
    default_title: string;
    default_formal_title: string;
    custom_title: string | null;
    custom_formal_title: string | null;
    description: string;
    created_at: string | null;
    updated_at: string | null;
  }>;
}
