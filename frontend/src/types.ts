export interface Person {
  id: string;
  name: string;
  english_name?: string | null;
  gender: 'M' | 'F' | 'O';
  dob?: string;
  dod?: string;
  tob?: string;
  tod?: string;
  avatar_url?: string | null;
  title?: string;
  metadata?: {
    position?: { x: number; y: number };
    customFields?: { label: string; value: string }[];
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
