## 2024-05-24 - Zero-Allocation Set Iteration
**Learning:** Using `[...set].some(...)` inside hot path resolution logic creates unnecessary intermediate arrays and invokes callback overhead, acting as a hidden bottleneck during complex graph traversals.
**Action:** Always replace spread syntax on Sets with zero-allocation `for...of` loops when checking for intersections or existence in performance-critical paths.

## 2024-05-24 - Array Method Allocation Traps
**Learning:** Chaining array methods like `path.slice(0, -1).every(...)` in tight loops creates intermediate array copies (`slice`) and incurs callback overhead (`every`), degrading performance in hot paths like `title_resolver.ts`.
**Action:** Replace allocating array chain operations with custom zero-allocation helper methods (e.g., `isAllSegments`) utilizing traditional `for` loops in hot paths.
