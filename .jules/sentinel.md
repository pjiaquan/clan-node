## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.
## 2023-10-27 - [CPU Exhaustion via Unbounded parseInt Inputs]
**Vulnerability:** API endpoints parsing untrusted string headers or query parameters (e.g., `content-length`, `depth`) using `parseInt` without enforcing length constraints.
**Learning:** `parseInt` executes in $O(N)$ time proportional to the string length. Attackers can submit arbitrarily long strings of numeric digits in headers or query parameters, causing V8 to hang and resulting in synchronous blocking of the event loop and CPU exhaustion (Denial of Service).
**Prevention:** Always enforce a strict maximum length (e.g., `.slice(0, 10)` or length checks) on raw strings before passing them to `parseInt`, and further clamp the resulting integer using `Math.max(MIN, Math.min(value, MAX))` to ensure it falls within the expected business logic bounds.
