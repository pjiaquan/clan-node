## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2025-02-14 - Fix modulo bias in MFA code generation
**Vulnerability:** MFA code generation (`createMfaCode`) in `src/auth.ts` applied a modulo operation (`% 1000000`) directly to a 32-bit random integer (`crypto.getRandomValues`). Because `4294967296` is not a clean multiple of `1000000`, this introduced cryptographic modulo bias, making certain MFA codes slightly more likely to be generated than others and reducing the overall security uniformly of the MFA system.
**Learning:** Whenever generating secure numeric tokens via modulo arithmetic from uniformly random bits, the modulus must be checked for bias if it does not cleanly divide the max value.
**Prevention:** Implement a rejection sampling loop that discards randomly generated values that fall outside the highest clean multiple of the modulus before applying the modulo operation.
