## 2024-05-26 - Breadth-First Search Array Shift Bottleneck
**Learning:** In `src/kinship/calculator.ts`, the Breadth-First Search (BFS) traversals for kinship calculations were bottlenecked by two main issues. First, using `Array.prototype.shift()` on the queue caused O(N) operations inside the loop, making the traversal O(N^2) overall. Second, dynamically filtering adjacency lists inside the traversal loop using `...neighbors.filter(...)` created massive unnecessary memory allocations and garbage collection pressure.
**Action:** Always use an index pointer (e.g., `let head = 0; queue[head++]`) instead of `queue.shift()` for queues in BFS traversals in JavaScript to maintain O(1) dequeue time. Pre-sort or pre-process adjacency lists during graph construction (e.g., `buildAdjacency`) rather than inside the hot path of the traversal loop to avoid redundant allocations.

## 2024-05-18 - Optimize Primary Avatar Pre-computation
**Learning:** In `src/backup.ts`, an O(N^2) time complexity bottleneck existed during primary avatar computation due to iterating over unique `personId`s and filtering a large `avatars` array each time. Grouping items by an ID into a Map before processing reduces time complexity to O(N).
**Action:** When working with large arrays of relations that need to be processed per entity ID, always group the items using a Map first instead of calling `.filter()` repeatedly inside a loop.

## 2024-07-27 - Concurrent Linking Optimization
**Learning:** In `linkSpousePairExistingChildren`, running independent asynchronous data mutations (`ensureParentChildLink`, `linkParentToSiblingChildren`) inside a sequential `for...of` loop creates an unnecessary bottleneck.
**Action:** Replace independent sequential loop bodies containing promises with `Promise.all` using array mappings (`array.map(...)`) to maximize concurrent execution while maintaining inner-loop sequentiality if required.

## 2024-05-18 - Optimize relationship validation in backup service
**Learning:** Found an O(N*M) time complexity bottleneck in `validateRelations` within `src/backup/service.ts`, where array `.find()` was being executed inside a loop across relationships, which caused O(N) operations inside an O(M) loop.
**Action:** Replace `Array.prototype.find` inside tight loops with an `O(1)` hash map / dictionary lookup created before the loop to reduce time complexity to O(N+M). This particular optimization reduced validation time for 5,000 nodes from ~3.75s to ~44ms.

## 2024-07-27 - [Concurrent Database Writes Optimization]
**Learning:** [Using sequential awaits in loops creates a severe N+1 problem against remote databases (like Cloudflare D1). For independent record insertions (e.g. custom fields for a person), resolving promises concurrently yields substantial speedups.]
**Action:** [When batching data insertions/updates that are not reliant on each other, prefer `Promise.all` mapping over `for...of` await loops to minimize RTT (Round Trip Time).]

## 2024-07-27 - N+1 Query in Sibling Link Creation
**Learning:** In `src/relationships.ts`, the process of creating missing sibling relationships and linking sibling networks ran in a sequential `for...of` loop over `otherChildren`. This caused an N+1 query pattern, where database roundtrips happened sequentially and blocked each other, resulting in significantly slower performance for large families.
**Action:** Always leverage concurrency when performing independent, async I/O operations in a loop (like database queries) by mapping over the array and wrapping it in `await Promise.all(...)`.

## 2025-02-28 - N+1 Queries in Custom Field Insertions
**Learning:** Consecutive database writes inside a for-loop (awaiting each insertion) create a severe N+1 bottleneck, causing sequential I/O blocking.
**Action:** Always batch database inserts or use `Promise.all()` to run independent insertions concurrently when possible.

## 2024-05-15 - N+1 Query Parallelization in Relationships
**Learning:** Sequential DB queries (like findRelationship, createRelationship) inside for...of loops for sibling relationship generation cause N+1 performance bottlenecks.
**Action:** Use Promise.all with array.map for independent relationship creations to parallelize I/O bounds tasks in Cloudflare D1 / SQLite setups where concurrent connections are supported or queued efficiently by the driver.

## 2024-07-27 - Sequential Execution of Promise-based Database Loops
**Learning:** In `src/relationships/service.ts`, `linkSiblingNetworks` used sequential `for...of` loops to execute database operations for two arrays of sibling IDs. This caused I/O operations to block on each other unnecessarily, leading to high latency for parents with multiple children (N+1 query bottleneck).
**Action:** When performing independent I/O tasks that do not depend on the result of the previous iteration (such as iterating over sibling networks to create links), replace `for...of` loops with `Promise.all` combined with `.map()` to enable concurrent execution and substantially reduce overall response time.
