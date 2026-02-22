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
