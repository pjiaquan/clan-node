-- Tracks the highest TOTP time-step accepted for each user so a captured code
-- cannot be replayed within the verification window.
ALTER TABLE users ADD COLUMN mfa_totp_last_counter INTEGER;
