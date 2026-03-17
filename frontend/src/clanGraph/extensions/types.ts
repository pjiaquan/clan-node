import type { CSSProperties, ComponentType } from 'react';
import type { Edge, MarkerType, NodeProps } from 'reactflow';
import type { GraphSettings } from '../../graphSettings';
import type { Person, Relationship } from '../../types';

export type GraphNodeComponent = ComponentType<NodeProps>;

export type GraphNodeRender = {
  type: string;
  data: Record<string, unknown>;
  style?: CSSProperties;
  className?: string;
};

export type GraphEdgeRender = {
  type: Edge['type'];
  animated?: boolean;
  markerEnd?: { type: MarkerType } | Edge['markerEnd'];
  style?: CSSProperties;
  label?: string;
  labelStyle?: CSSProperties;
  zIndex?: number;
  interactionWidth?: number;
};

export type GraphExtensionContext = {
  graphSettings: GraphSettings;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export type GraphExtension = {
  id: string;
  nodeTypes?: Record<string, GraphNodeComponent>;
  resolveNodeRender?: (args: {
    person: Person;
    current: GraphNodeRender;
    context: GraphExtensionContext;
  }) => Partial<GraphNodeRender> | null | undefined;
  resolveEdgeRender?: (args: {
    relationship: Relationship;
    current: GraphEdgeRender;
    context: GraphExtensionContext;
  }) => Partial<GraphEdgeRender> | null | undefined;
};
