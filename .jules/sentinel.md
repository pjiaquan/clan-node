## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2024-05-01 - Prevented Cryptographic Modulo Bias
**Vulnerability:** Weak random number generation in `createMfaCode` using `% 1000000` on a randomly generated 32-bit unsigned integer (modulo bias).
**Learning:** `crypto.getRandomValues(new Uint32Array(1))[0] % 1000000` is biased because $2^{32}$ is not cleanly divisible by $1000000$, making lower values slightly more likely. Note that standard TOTP/HOTP truncation using modulo (e.g., `% (10 ** TOTP_DIGITS)`) on HMAC hashes is required by RFC 6238/4226 and should not be replaced.
**Prevention:** Implement rejection sampling by determining the highest clean multiple of the modulus (e.g., `Math.floor(4294967296 / 1000000) * 1000000`) and continuously re-rolling if the random number is greater than or equal to this threshold, before applying the modulo operation.
