## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.
## 2026-09-24 - Fix modulo bias in random number generation
**Vulnerability:** Generating 6-digit MFA codes using `crypto.getRandomValues(new Uint32Array(1))[0] % 1000000` introduces a cryptographic modulo bias, where lower values are slightly more likely to be generated than higher ones because the maximum value of a Uint32 (4,294,967,295) is not perfectly divisible by 1,000,000.
**Learning:** Relying on simple modulo arithmetic for cryptographic or security-related random number generation is unsafe when the modulus is not a power of 2 that evenly divides the random space.
**Prevention:** Use rejection sampling to discard values that fall outside the highest clean multiple of the modulus before applying the modulo operation. This ensures a perfectly uniform distribution.
