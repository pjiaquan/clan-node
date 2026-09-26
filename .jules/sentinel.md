## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2024-05-27 - Cryptographic Modulo Bias in Security Codes
**Vulnerability:** Found `crypto.getRandomValues(new Uint32Array(1))[0] % 1000000` for MFA code generation.
**Learning:** Using modulo arithmetic on uniformly distributed 32-bit random integers introduces a small but cryptographically significant bias because the maximum value (`4,294,967,295`) is not a clean multiple of `1,000,000`. The lower numbers have a slightly higher probability of being generated.
**Prevention:** Always implement rejection sampling. Loop and redraw `getRandomValues` if the value is greater than or equal to the highest clean multiple of the divisor (e.g., `Math.floor(4294967296 / 1000000) * 1000000`) before applying modulo, ensuring a perfectly uniform distribution.
