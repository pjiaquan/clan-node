## 2023-10-27 - [CPU Exhaustion DoS via Hash Inputs]
**Vulnerability:** Long passwords could cause ReDoS or CPU-exhaustion if they reach PBKDF2 hashing routines.
**Learning:** PBKDF2 is computationally expensive by design. Unbounded inputs combined with expensive hashing algorithms expose the server to CPU exhaustion attacks.
**Prevention:** Always bound the maximum length of user inputs (e.g., passwords, emails) *before* passing them to hashing functions or complex regular expressions.
