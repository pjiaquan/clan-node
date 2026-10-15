## 2025-02-14 - Fix missing password length limits (DoS risk)
**Vulnerability:** Multiple critical authentication endpoints (/login, /reset-password, /users/:id) lacked maximum length validation on the password input, exposing the application to resource exhaustion (DoS) attacks via computationally expensive hashing algorithms.
**Learning:** `PASSWORD_MAX_LENGTH` was defined in `src/auth.ts` but its enforcement was inconsistent across routes, particularly in routes added later or less frequently audited.
**Prevention:** Always enforce both minimum and maximum length bounds consistently across all user input endpoints before passing data to expensive cryptographic operations. Ensure bounds check is conditionally applied for optional fields.
## 2024-10-15 - Input parsing DoS via unconstrained queries and headers
**Vulnerability:** Untrusted query parameters (`limit`, `before`) and HTTP headers (`content-length`) were evaluated against regexes or parsed by `parseInt`/`Number` without strict length constraints.
**Learning:** Malicious actors could send extremely long numeric strings, triggering resource exhaustion (DoS) during parsing or regex evaluation (e.g. `^\d+$`).
**Prevention:** Always apply aggressive length constraints (e.g. `.slice(0, 10)` or `.length > 20`) on query strings and headers *before* attempting type conversions or regex evaluations.
