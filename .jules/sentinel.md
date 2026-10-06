## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2025-02-14 - Fix modulo bias in MFA code generation
**Vulnerability:** `createMfaCode` in `src/auth.ts` generated 6-digit MFA codes by generating a random 32-bit integer and applying a modulo of 1000000 directly. This introduces cryptographic modulo bias, rendering smaller numeric results slightly more likely because the maximal limit of `Uint32` is not a clean multiple of the modulus.
**Learning:** Standard generation of bounded numeric secrets via direct modulo division inherits modulo bias when the source entropy (like 2^32 possible values of Uint32) is not perfectly divisible by the boundary limit.
**Prevention:** Always implement rejection sampling when generating random numbers with specific bounds using `crypto.getRandomValues`. Discard random samples that exceed the highest clean multiple of the intended modulus to ensure a perfectly uniform distribution.
