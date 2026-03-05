import type { RelationshipTypeKey } from '../types';

export const CTRL_HOVER_DIM_NODE_OPACITY = 0.18;
export const CTRL_HOVER_DIM_EDGE_OPACITY = 0.12;
export const CTRL_HOVER_EDGE_WIDTH_BOOST = 2;
export const CTRL_HOVER_MIN_EDGE_WIDTH = 4;
export const EDGE_FOCUS_DIM_NODE_OPACITY = 0.2;
export const EDGE_FOCUS_DIM_EDGE_OPACITY = 0.2;
export const COARSE_MIN_DRAG_DISTANCE_BONUS = 6;
export const COARSE_Y_SNAP_BONUS = 4;
export const COARSE_Y_RELEASE_BONUS = 6;
export const COARSE_X_SNAP_BONUS = 10;
export const COARSE_X_RELEASE_BONUS = 12;
export const COARSE_SPOUSE_SNAP_BONUS = 14;
export const COARSE_SPOUSE_RELEASE_BONUS = 20;

export const DEFAULT_RELATIONSHIP_TYPE_LABELS: Record<RelationshipTypeKey, string> = {
  parent_child: '親子',
  spouse: '夫妻',
  ex_spouse: '前配偶',
  sibling: '手足',
  in_law: '姻親',
};
