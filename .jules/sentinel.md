## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.

## 2025-02-14 - Fix modulo bias in MFA code generation
**Vulnerability:** The MFA code generator used modulo on an unbiased random number (`crypto.getRandomValues(...) % 1000000`). Since the maximum value of a Uint32 (4294967295) is not perfectly divisible by 1000000, numbers in the lower range were slightly more likely to occur than numbers in the higher range (cryptographic modulo bias).
**Learning:** Even when using cryptographically secure random number generators (CSPRNG), naively applying modulo arithmetic introduces bias unless the range is a perfect multiple of the divisor.
**Prevention:** Use rejection sampling to discard random values that fall in the "remainder" of the modulus at the top of the range.
