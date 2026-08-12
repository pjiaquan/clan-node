## 2024-05-24 - Unsafe Parallelization of Read-Modify-Write in Relationships
**Learning:** The relationship linkage functions (e.g. `linkSpouseToChild`, `linkParentToSiblingChildren`) rely on a read-modify-write pattern (`findRelationship`, if missing -> `createRelationship`). Parallelizing outer loops (e.g., across siblings or spouses) causes overlapping concurrent checks that fail to see uncommitted inserts from parallel threads, leading to duplicate edges and constraint violations due to the lack of DB-level upserts or transactions in SQLite D1.
**Action:** When parallelizing queries, ensure they are strictly read-only (`getSiblingIds`, `getSiblingLinkMeta`) or write-only independent operations. Avoid parallelizing `ensure*Link` or complex graph traversal writes unless a strict lock or `INSERT OR IGNORE` strategy exists at the database level.
## 2024-05-18 - Cached sorted sibling lists in SiblingRankComputer
**Learning:** Repeating identical sort operations (e.g. sorting same-gender siblings by DOB) inside loops during batch graph calculation causes massive slowdowns (O(N * M log M) complexity).
**Action:** Always cache the results of expensive operations (like sorting arrays based on static data) when calculating relative values for many nodes across a graph. Use `Map` keyed by `reference.id` + `gender`.
## 2024-05-24 - Expensive Date Instantiation in Sort Loops
**Learning:** Instantiating `new Date(string)` inside `.sort()` comparators is extremely slow (approx. 10x slower) because the string parsing happens O(N log N) times.
**Action:** When sorting dates that are already in ISO 8601 format, rely on direct string lexicographical comparison (`<` and `>`) to skip Date instantiation entirely.
## 2024-05-24 - O(N) Array Filtration in BFS Graph Traversal
**Learning:** Checking path segments with `.filter((segment) => segment === 'inlaw').length` inside the inner loop of a Breath-First Search causes a severe performance bottleneck because it runs in O(N) time per step and generates disposable array garbage inside a hot traversal loop.
**Action:** When tracking cumulative path metrics (like in-law count, depth, or specific edges) during a graph traversal, avoid re-evaluating the entire path array. Instead, increment the metric as an O(1) state property on the traversal queue object (`TraversalStep`).
