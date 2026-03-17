import { defaultGraphExtension } from './defaultExtension';
import type { GraphEdgeRender, GraphExtension, GraphExtensionContext, GraphNodeRender } from './types';
import type { Person, Relationship } from '../../types';

const mergeNodeRender = (current: GraphNodeRender, patch?: Partial<GraphNodeRender> | null): GraphNodeRender => {
  if (!patch) return current;
  return {
    ...current,
    ...patch,
    data: patch.data ? { ...current.data, ...patch.data } : current.data,
    style: patch.style ? { ...current.style, ...patch.style } : current.style,
  };
};

const mergeEdgeRender = (current: GraphEdgeRender, patch?: Partial<GraphEdgeRender> | null): GraphEdgeRender => {
  if (!patch) return current;
  return {
    ...current,
    ...patch,
    style: patch.style ? { ...current.style, ...patch.style } : current.style,
    labelStyle: patch.labelStyle ? { ...current.labelStyle, ...patch.labelStyle } : current.labelStyle,
  };
};

const graphExtensions: GraphExtension[] = [
  defaultGraphExtension,
];

export const registerGraphExtensions = (extensions: GraphExtension[]) => {
  graphExtensions.push(...extensions);
};

export const getGraphExtensions = () => graphExtensions;

export const getGraphNodeTypes = () => (
  graphExtensions.reduce<Record<string, NonNullable<GraphExtension['nodeTypes']>[string]>>((all, extension) => {
    if (!extension.nodeTypes) return all;
    return { ...all, ...extension.nodeTypes };
  }, {})
);

export const resolveGraphNodeRender = (
  person: Person,
  base: GraphNodeRender,
  context: GraphExtensionContext
) => (
  graphExtensions.reduce(
    (current, extension) => mergeNodeRender(current, extension.resolveNodeRender?.({ person, current, context })),
    base
  )
);

export const resolveGraphEdgeRender = (
  relationship: Relationship,
  base: GraphEdgeRender,
  context: GraphExtensionContext
) => (
  graphExtensions.reduce(
    (current, extension) => mergeEdgeRender(current, extension.resolveEdgeRender?.({ relationship, current, context })),
    base
  )
);
