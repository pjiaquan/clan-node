export const LOGIN_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 5, blockMs: 15 * 60 * 1000 };
export const ACCOUNT_LOGIN_RATE_LIMIT = { windowMs: 30 * 60 * 1000, maxAttempts: 12, blockMs: 30 * 60 * 1000 };
export const MFA_SEND_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 3, blockMs: 15 * 60 * 1000 };
export const RESEND_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 3, blockMs: 30 * 60 * 1000 };
export const FORGOT_PASSWORD_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 5, blockMs: 30 * 60 * 1000 };

export const ACCOUNT_AVATAR_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 10, blockMs: 15 * 60 * 1000 };
export const PEOPLE_CREATE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 30, blockMs: 15 * 60 * 1000 };
export const PERSON_AVATAR_UPLOAD_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 20, blockMs: 15 * 60 * 1000 };
export const NOTIFICATION_CREATE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 20, blockMs: 15 * 60 * 1000 };
export const RELATIONSHIP_WRITE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 120, blockMs: 15 * 60 * 1000 };
export const LAYER_WRITE_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 20, blockMs: 15 * 60 * 1000 };
export const RELATIONSHIP_LABEL_WRITE_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 40, blockMs: 15 * 60 * 1000 };
export const KINSHIP_LABEL_WRITE_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 40, blockMs: 15 * 60 * 1000 };
export const BACKUP_EXPORT_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 10, blockMs: 15 * 60 * 1000 };
export const BACKUP_IMPORT_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxAttempts: 3, blockMs: 60 * 60 * 1000 };
export const MFA_VERIFY_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 10, blockMs: 15 * 60 * 1000 };
export const INVITE_CREATE_RATE_LIMIT = { windowMs: 15 * 60 * 1000, maxAttempts: 10, blockMs: 15 * 60 * 1000 };
