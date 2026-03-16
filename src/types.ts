export type Env = {
  DB: D1Database;
  AVATARS: R2Bucket;
  ADMIN_SETUP_TOKEN?: string;
  AUTH_ENCRYPTION_KEY?: string;
  FRONTEND_ORIGIN?: string;
  ENVIRONMENT?: string;
  EMAIL_VERIFICATION_URL_BASE?: string;
  BREVO_API_KEY?: string;
  BREVO_FROM_EMAIL?: string;
  BREVO_FROM_NAME?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DUAL_WRITE_REMOTE?: string;
  DUAL_WRITE_REMOTE_BASE?: string;
  DUAL_WRITE_REMOTE_ORIGIN?: string;
  DUAL_WRITE_REMOTE_USER?: string;
  DUAL_WRITE_REMOTE_PASS?: string;
};

export type UserRole = 'admin' | 'readonly';

export type SessionUser = {
  userId: string;
  username: string;
  role: UserRole;
};

export type AppBindings = {
  Bindings: Env;
  Variables: {
    sessionUser?: SessionUser;
  };
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
  blood_type?: string | null;
  dob?: string;
  title?: string;
  formal_title?: string;
}
