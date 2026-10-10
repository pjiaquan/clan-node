-- Holds a requested e-mail address until its owner proves control of it, so a
-- change does not move the account's sign-in identity before verification.
ALTER TABLE users ADD COLUMN pending_email TEXT;
