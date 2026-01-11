export type Env = {
  DB: D1Database;
  AVATARS: R2Bucket;
  ADMIN_SETUP_TOKEN?: string;
  FRONTEND_ORIGIN?: string;
  ENVIRONMENT?: string;
};

export interface Relationship {
  id: number;
  from_person_id: string;
  to_person_id: string;
  type: string;
}

export interface Person {
  id: string;
  name: string;
  english_name?: string | null;
  gender: string;
  dob?: string;
}
