## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.
## 2025-02-14 - Fix cryptographic modulo bias in MFA generation
**Vulnerability:** The MFA code generator used `crypto.getRandomValues(new Uint32Array(1))[0] % 1000000`. Using modulo directly on a uniformly distributed 32-bit random integer introduces cryptographic modulo bias, meaning the generated tokens were not perfectly uniformly distributed.
**Learning:** `crypto.getRandomValues` produces a secure random stream, but naive application of modulo operation warps the statistical distribution because the maximum integer size (`4,294,967,295`) is not perfectly divisible by the modulus (e.g. `1000000`).
**Prevention:** When generating numeric security codes, implement rejection sampling to discard random values strictly greater than or equal to the highest exact multiple of the modulus.
