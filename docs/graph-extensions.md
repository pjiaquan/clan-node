# Graph Extensions

This repo now has a small in-repo extension layer for graph rendering. The goal is to let developers add custom node components or override edge appearance without editing the core graph logic in `frontend/src/ClanGraph.tsx`.

## Where to look

- Extension contract: `frontend/src/clanGraph/extensions/types.ts`
- Registry: `frontend/src/clanGraph/extensions/registry.ts`
- Built-in behavior: `frontend/src/clanGraph/extensions/defaultExtension.ts`
- Sample extension: `frontend/src/clanGraph/extensions/examples/highlightedBloodlineExtension.ts`
- Core graph wiring: `frontend/src/ClanGraph.tsx`

## What an extension can change

- Register new React Flow node components
- Choose a different node type for a person
- Patch node data and node style before render
- Patch edge type, edge style, label, animation, and interaction width

The registry composes extensions in order. Later extensions win when they override the same fields.

## Add a custom node

1. Create a node component under `frontend/src/`, for example `frontend/src/StatusPersonNode.tsx`.
2. Create an extension file.
3. Register that extension in `frontend/src/clanGraph/extensions/registry.ts`.
4. Mark the person with `person.metadata.render.nodeType = 'status-person'`.

Example extension:

```ts
import StatusPersonNode from '../../StatusPersonNode';
import type { GraphExtension } from './types';

export const statusNodeExtension: GraphExtension = {
  id: 'status-node',
  nodeTypes: {
    'status-person': StatusPersonNode,
  },
  resolveNodeRender: ({ person, current }) => {
    if (person.metadata?.render?.nodeType !== 'status-person') {
      return null;
    }

    return {
      data: {
        badgeText: person.metadata?.status ?? 'Unknown',
      },
    };
  },
};
```

Register it:

```ts
const graphExtensions: GraphExtension[] = [
  defaultGraphExtension,
  statusNodeExtension,
];
```

There is also a concrete sample in `frontend/src/clanGraph/extensions/examples/highlightedBloodlineExtension.ts` that shows how to drive both node and edge appearance from `metadata.render.variant`.

## Change edge style

Use `resolveEdgeRender` when you want to change line color, dash pattern, edge type, or labels.

Example:

```ts
import type { GraphExtension } from './types';

export const dashedInLawExtension: GraphExtension = {
  id: 'dashed-in-law',
  resolveEdgeRender: ({ relationship }) => {
    if (relationship.type !== 'in_law') {
      return null;
    }

    return {
      type: 'straight',
      animated: false,
      style: {
        stroke: '#b45309',
        strokeDasharray: '10 6',
        strokeWidth: 3,
      },
    };
  },
};
```

## Metadata hints

The data model now exposes lightweight render hints:

- `person.metadata.render.nodeType`
- `person.metadata.render.variant`
- `relationship.metadata.render.edgeType`
- `relationship.metadata.render.variant`

Keep these as hints only. Business logic should still use canonical fields like `person.gender` or `relationship.type`.

## Ground rules

- Prefer small extensions over editing `ClanGraph.tsx`.
- Keep layout and data-fetch logic in the core graph.
- Use extensions for presentation and render-specific behavior.
- If multiple extensions might touch the same node or edge, document the expected order in `registry.ts`.
