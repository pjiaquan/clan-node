## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.
## 2024-05-27 - Fix Modulo Bias in MFA Code Generation
**Vulnerability:** Modulo Bias in MFA code generation using `crypto.getRandomValues(new Uint32Array(1))[0] % 1000000`.
**Learning:** `Uint32Array` values range up to `4294967295`, which is not perfectly divisible by `1000000`. The remainder biases towards lower numeric values (0 to 7295) making them slightly more likely to be selected than the higher range, weakening the uniformly random distribution.
**Prevention:** Always use rejection sampling when mapping cryptographic random integers to an arbitrary range that is not a power of 2, specifically capping the range to `MAX_VALUE - (MAX_VALUE % TARGET_MODULO)`.
