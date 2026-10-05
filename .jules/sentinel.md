## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2025-02-15 - Add input length limits to numerical parsings (DoS risk)
**Vulnerability:** Multiple endpoints parsing untrusted inputs into numbers (e.g., query parameters passed to `Number()` and `parseInt()`) lacked length validation. Extremely long strings can trigger exponential time complexity parsing in some JS environments, causing CPU exhaustion DoS.
**Learning:** Even built-in basic numerical parsings (`Number`, `parseInt`) need input bounds because malicious actors can pass megabyte-long query parameters or headers.
**Prevention:** Always truncate or limit the length of string inputs (`.slice(0, 15)`) *before* passing them to any computational parser, even standard numeric ones.