## 2024-05-24 - BFS Traversal Array Recalculation Bottleneck
**Learning:** In heavily nested breadth-first search logic used for kinship mapping, evaluating tie-breaking criteria using array iteration tools like `.filter().length` on cumulative traversal paths creates significant performance hits due to compounding O(N) evaluations inside the main inner O(V+E) loop.
**Action:** Always maintain cumulative metrics like `inlawCount` incrementally on the traversal state/queue objects (e.g., `TraversalStep`) to ensure checking them remains an O(1) operation during graph traversal.
