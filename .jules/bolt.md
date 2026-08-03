## 2024-05-24 - Unsafe Parallelization of Read-Modify-Write in Relationships
**Learning:** The relationship linkage functions (e.g. `linkSpouseToChild`, `linkParentToSiblingChildren`) rely on a read-modify-write pattern (`findRelationship`, if missing -> `createRelationship`). Parallelizing outer loops (e.g., across siblings or spouses) causes overlapping concurrent checks that fail to see uncommitted inserts from parallel threads, leading to duplicate edges and constraint violations due to the lack of DB-level upserts or transactions in SQLite D1.
**Action:** When parallelizing queries, ensure they are strictly read-only (`getSiblingIds`, `getSiblingLinkMeta`) or write-only independent operations. Avoid parallelizing `ensure*Link` or complex graph traversal writes unless a strict lock or `INSERT OR IGNORE` strategy exists at the database level.
## 2024-05-18 - Cached sorted sibling lists in SiblingRankComputer
**Learning:** Repeating identical sort operations (e.g. sorting same-gender siblings by DOB) inside loops during batch graph calculation causes massive slowdowns (O(N * M log M) complexity).
**Action:** Always cache the results of expensive operations (like sorting arrays based on static data) when calculating relative values for many nodes across a graph. Use `Map` keyed by `reference.id` + `gender`.
## 2024-05-24 - Expensive Date Instantiation in Sort Loops
**Learning:** Instantiating `new Date(string)` inside `.sort()` comparators is extremely slow (approx. 10x slower) because the string parsing happens O(N log N) times.
**Action:** When sorting dates that are already in ISO 8601 format, rely on direct string lexicographical comparison (`<` and `>`) to skip Date instantiation entirely.
## 2024-06-15 - Incremental state tracking vs Array filtering in BFS
**Learning:** During Breadth-First Search traversals, repeatedly computing path metrics (like counting specific relationship types such as 'inlaw') using `O(N)` array operations (`.filter().length`) creates a severe performance bottleneck as paths grow.
**Action:** Instead of iterating over the path history to compute metrics at each step, pass the calculated metrics forward incrementally as part of the `O(1)` queue state (e.g., adding an `inlawCount` property to `TraversalStep`).
