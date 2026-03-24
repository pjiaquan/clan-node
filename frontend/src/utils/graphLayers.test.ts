import { describe, expect, it } from 'vitest';
import {
  GRAPH_LAYER_BUNDLE_VERSION,
  addGraphLayer,
  createGraphLayer,
  exportGraphLayerBundle,
  importGraphLayerBundle,
} from './graphLayers';

describe('graphLayers', () => {
  it('creates a new layer with three example nodes and two edges', () => {
    const layer = createGraphLayer({
      id: 'layer-1',
      name: 'Alpha',
      now: '2026-03-24T00:00:00.000Z',
    });

    expect(layer.id).toBe('layer-1');
    expect(layer.name).toBe('Alpha');
    expect(layer.nodes).toHaveLength(3);
    expect(layer.edges).toHaveLength(2);
    expect(layer.center).toBe(layer.nodes[0].id);
    expect(layer.nodes.map((node) => node.name)).toEqual([
      'Alpha Root',
      'Alpha Node A',
      'Alpha Node B',
    ]);
  });

  it('adds layers without mutating existing layer data', () => {
    const original = addGraphLayer(null, {
      id: 'layer-a',
      name: 'Layer A',
      now: '2026-03-24T00:00:00.000Z',
    });
    const originalSnapshot = structuredClone(original.layers[0]);

    const next = addGraphLayer(original, {
      id: 'layer-b',
      name: 'Layer B',
      now: '2026-03-24T01:00:00.000Z',
    });

    expect(next.layers).toHaveLength(2);
    expect(next.activeLayerId).toBe('layer-b');
    expect(original.layers).toHaveLength(1);
    expect(original.layers[0]).toEqual(originalSnapshot);
    expect(next.layers[0]).toEqual(originalSnapshot);
    expect(next.layers[1].name).toBe('Layer B');
  });

  it('round-trips through export and import', () => {
    const bundle = addGraphLayer(null, {
      id: 'layer-a',
      name: 'Layer A',
      now: '2026-03-24T00:00:00.000Z',
    });
    const second = addGraphLayer(bundle, {
      id: 'layer-b',
      name: 'Layer B',
      now: '2026-03-24T01:00:00.000Z',
    });

    const exported = exportGraphLayerBundle(second);
    const imported = importGraphLayerBundle(exported);

    expect(imported).toEqual(second);
    expect(imported.version).toBe(GRAPH_LAYER_BUNDLE_VERSION);
  });

  it('rejects edges that point outside the layer', () => {
    expect(() => importGraphLayerBundle({
      version: GRAPH_LAYER_BUNDLE_VERSION,
      activeLayerId: 'layer-a',
      layers: [
        {
          id: 'layer-a',
          name: 'Layer A',
          center: 'node-1',
          createdAt: '2026-03-24T00:00:00.000Z',
          updatedAt: '2026-03-24T00:00:00.000Z',
          nodes: [
            { id: 'node-1', name: 'One', gender: 'O' },
          ],
          edges: [
            {
              id: 1,
              from_person_id: 'node-1',
              to_person_id: 'node-2',
              type: 'parent_child',
            },
          ],
        },
      ],
    })).toThrow(/outside the layer/);
  });
});
