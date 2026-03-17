import PersonNode from '../../PersonNode';
import type { GraphExtension } from './types';

export const defaultGraphExtension: GraphExtension = {
  id: 'default',
  nodeTypes: {
    person: PersonNode,
  },
};
