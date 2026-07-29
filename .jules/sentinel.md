## 2023-10-27 - [CPU Exhaustion DoS via Hash Inputs]
**Vulnerability:** Long passwords could cause ReDoS or CPU-exhaustion if they reach PBKDF2 hashing routines.
**Learning:** PBKDF2 is computationally expensive by design. Unbounded inputs combined with expensive hashing algorithms expose the server to CPU exhaustion attacks.
**Prevention:** Always bound the maximum length of user inputs (e.g., passwords, emails) *before* passing them to hashing functions or complex regular expressions.
## 2025-05-18 - [SQL Injection via Dynamic Column Names in Repositories]
**Vulnerability:** SQL Injection in dynamic D1 database queries.
**Learning:** Object keys generated via `Object.entries(updates)` were directly interpolated into SQL strings (e.g. `` `UPDATE people SET ${columns.join(', ')}` ``) without validation, which could allow attackers to execute arbitrary SQL commands if they could control the object keys.
**Prevention:** Validate all dynamically generated column names against an allowlist pattern (e.g., `/^[a-zA-Z0-9_]+$/`) before allowing them to be interpolated into queries.
