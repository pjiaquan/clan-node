## 2024-05-24 - Unsafe Parallelization of Read-Modify-Write in Relationships
**Learning:** The relationship linkage functions (e.g. `linkSpouseToChild`, `linkParentToSiblingChildren`) rely on a read-modify-write pattern (`findRelationship`, if missing -> `createRelationship`). Parallelizing outer loops (e.g., across siblings or spouses) causes overlapping concurrent checks that fail to see uncommitted inserts from parallel threads, leading to duplicate edges and constraint violations due to the lack of DB-level upserts or transactions in SQLite D1.
**Action:** When parallelizing queries, ensure they are strictly read-only (`getSiblingIds`, `getSiblingLinkMeta`) or write-only independent operations. Avoid parallelizing `ensure*Link` or complex graph traversal writes unless a strict lock or `INSERT OR IGNORE` strategy exists at the database level.
## 2024-05-18 - Cached sorted sibling lists in SiblingRankComputer
**Learning:** Repeating identical sort operations (e.g. sorting same-gender siblings by DOB) inside loops during batch graph calculation causes massive slowdowns (O(N * M log M) complexity).
**Action:** Always cache the results of expensive operations (like sorting arrays based on static data) when calculating relative values for many nodes across a graph. Use `Map` keyed by `reference.id` + `gender`.
## 2024-05-24 - Expensive Date Instantiation in Sort Loops
**Learning:** Instantiating `new Date(string)` inside `.sort()` comparators is extremely slow (approx. 10x slower) because the string parsing happens O(N log N) times.
**Action:** When sorting dates that are already in ISO 8601 format, rely on direct string lexicographical comparison (`<` and `>`) to skip Date instantiation entirely.
## 2026-08-17 - O(1) Metric Tracking in Graph Traversals
**Learning:** Filtering arrays on every visited node during graph traversals (e.g. `.filter(segment => segment === 'inlaw').length`) creates hidden O(N) bottlenecks inside loops that become problematic for deeper tree depths.
**Action:** Track performance metrics incrementally as O(1) state variables within the traversal node or queue object itself, modifying the metric during the transition step instead of recounting on read.
