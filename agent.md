## Impact Analysis & User Prompts (Dependency-aware Changes)

### When to perform Impact Analysis (Triggers)
Before making changes, perform a quick impact analysis if ANY is true:
- Modifying public APIs / exported functions / shared modules
- Touching auth/permission, validation, error handling, serialization
- Changing data models, DB schema, caching keys, message formats
- Altering timeouts/retries, concurrency, background jobs
- Refactoring cross-cutting concerns (logging, metrics, middleware)
- Fixing a bug that may exist in multiple similar call sites

### What to output (Mandatory)
When triggers apply, output a short "Impact & Options" section containing:
1) Potential affected components (call sites, modules, endpoints, jobs)
2) Risks / failure modes (compatibility, security, performance, data integrity)
3) Options (minimal fix vs. broader fix), with pros/cons
4) Recommendation (default safest path)
5) A question to the user on whether to include the broader fixes

### Default behavior (If user does not respond)
- Proceed with the minimal safe fix + add regression tests.
- Leave TODO notes only when necessary; prefer creating follow-up items.
- Do NOT expand scope automatically unless the risk is security-critical.

### Security-critical exception
If impact analysis reveals a likely security vulnerability, fix it proactively
(with minimal blast radius), add tests, and clearly highlight it.
