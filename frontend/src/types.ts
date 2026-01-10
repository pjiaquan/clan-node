export interface Person {
  id: string;
  name: string;
  gender: 'M' | 'F' | 'O';
  dob?: string;
  avatar_url?: string;
  title?: string;
  metadata?: {
    position?: { x: number; y: number };
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
