import type { GraphExtension } from '../types';

// Example only. Import and register this extension in `registry.ts` to enable it.
export const highlightedBloodlineExtension: GraphExtension = {
  id: 'highlighted-bloodline',
  resolveNodeRender: ({ person }) => {
    if (person.metadata?.render?.variant !== 'highlighted-bloodline') {
      return null;
    }

    return {
      className: 'node-variant-highlighted-bloodline',
      style: {
        boxShadow: '0 0 0 3px rgba(245, 158, 11, 0.35)',
      },
      data: {
        title: person.title || 'Bloodline',
      },
    };
  },
  resolveEdgeRender: ({ relationship }) => {
    if (relationship.metadata?.render?.variant !== 'highlighted-bloodline') {
      return null;
    }

    return {
      style: {
        stroke: '#d97706',
        strokeWidth: 3,
        strokeDasharray: '10 6',
      },
      label: 'Bloodline',
      animated: false,
    };
  },
};
