import type { Person, Relationship } from '../types';
import { KinshipTitleResolver } from './title_resolver';

export type KinshipCalculationContext = {
  centerId: string;
  targetId: string;
  relationships: Relationship[];
  people: Person[];
  centerPerson: Person;
};

export type KinshipCalculationResult = {
  title: string;
  formalTitle: string;
};

export interface KinshipCalculator {
  calculate(ctx: KinshipCalculationContext): KinshipCalculationResult;
}

type TraversalStep = {
  id: string;
  path: string[];
  nodePath: string[];
};

type AdjacencyEdge = {
  id: string;
  direction: 'up' | 'down' | 'spouse' | 'ex_spouse' | 'sibling' | 'inlaw';
};

export class BreadthFirstKinshipCalculator implements KinshipCalculator {
  calculate(ctx: KinshipCalculationContext): KinshipCalculationResult {
    const { centerId, targetId, relationships, people, centerPerson } = ctx;
    const directAncestorPath = this.findDirectAncestorPath(centerId, targetId, relationships);
    const resolver = new KinshipTitleResolver(centerPerson, people, relationships);

    if (directAncestorPath) {
      return this.formatResult(resolver.resolve({ ...directAncestorPath, targetId }));
    }

    const bestPath = this.findShortestPreferredPath(centerId, targetId, relationships);
    if (bestPath) {
      return this.formatResult(resolver.resolve({ ...bestPath, targetId }));
    }

    return this.formatResult('未知');
  }

  private formatResult(rawTitle: string): KinshipCalculationResult {
    const trimmed = rawTitle.trim();
    const match = trimmed.match(/^(.*)（(.*)）$/);
    if (match) {
      const colloquial = match[1].trim();
      const formal = match[2].trim();
      return {
        title: colloquial || trimmed,
        formalTitle: formal || trimmed,
      };
    }
    return { title: trimmed, formalTitle: trimmed };
  }

  private findDirectAncestorPath(centerId: string, targetId: string, relationships: Relationship[]) {
    const parentMap = new Map<string, string[]>();
    relationships.forEach((relationship) => {
      if (relationship.type === 'parent_child') {
        if (!parentMap.has(relationship.to_person_id)) parentMap.set(relationship.to_person_id, []);
        parentMap.get(relationship.to_person_id)?.push(relationship.from_person_id);
      }
    });

    const queue: TraversalStep[] = [{ id: centerId, path: [], nodePath: [centerId] }];
    const visited = new Set<string>([centerId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.id === targetId && current.path.length > 0) {
        return { path: current.path, nodePath: current.nodePath };
      }
      const parents = parentMap.get(current.id) || [];
      for (const parentId of parents) {
        if (!visited.has(parentId)) {
          visited.add(parentId);
          queue.push({
            id: parentId,
            path: [...current.path, 'up'],
            nodePath: [...current.nodePath, parentId],
          });
        }
      }
    }

    return null;
  }

  private buildAdjacency(relationships: Relationship[]) {
    const adjacency = new Map<string, AdjacencyEdge[]>();

    for (const relationship of relationships) {
      if (!relationship.from_person_id || !relationship.to_person_id) continue;
      if (!adjacency.has(relationship.from_person_id)) adjacency.set(relationship.from_person_id, []);
      if (!adjacency.has(relationship.to_person_id)) adjacency.set(relationship.to_person_id, []);

      const fromNode = adjacency.get(relationship.from_person_id);
      const toNode = adjacency.get(relationship.to_person_id);
      if (!fromNode || !toNode) continue;

      if (relationship.type === 'parent_child') {
        fromNode.push({ id: relationship.to_person_id, direction: 'down' });
        toNode.push({ id: relationship.from_person_id, direction: 'up' });
      } else if (relationship.type === 'spouse') {
        fromNode.push({ id: relationship.to_person_id, direction: 'spouse' });
        toNode.push({ id: relationship.from_person_id, direction: 'spouse' });
      } else if (relationship.type === 'ex_spouse') {
        fromNode.push({ id: relationship.to_person_id, direction: 'ex_spouse' });
        toNode.push({ id: relationship.from_person_id, direction: 'ex_spouse' });
      } else if (relationship.type === 'sibling') {
        fromNode.push({ id: relationship.to_person_id, direction: 'sibling' });
        toNode.push({ id: relationship.from_person_id, direction: 'sibling' });
      } else if (relationship.type === 'in_law') {
        fromNode.push({ id: relationship.to_person_id, direction: 'inlaw' });
        toNode.push({ id: relationship.from_person_id, direction: 'inlaw' });
      }
    }

    return adjacency;
  }

  private findShortestPreferredPath(centerId: string, targetId: string, relationships: Relationship[]) {
    const adjacency = this.buildAdjacency(relationships);
    const queue: TraversalStep[] = [{ id: centerId, path: [], nodePath: [centerId] }];
    const visited = new Set<string>([centerId]);
    let foundDepth: number | null = null;
    let bestPath: { path: string[]; nodePath: string[] } | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.id === targetId) {
        if (foundDepth === null) {
          foundDepth = current.path.length;
          bestPath = { path: current.path, nodePath: current.nodePath };
        } else if (current.path.length === foundDepth) {
          const currentInlawCount = current.path.filter((segment) => segment === 'inlaw').length;
          const bestInlawCount = bestPath
            ? bestPath.path.filter((segment) => segment === 'inlaw').length
            : Number.POSITIVE_INFINITY;
          if (currentInlawCount < bestInlawCount) {
            bestPath = { path: current.path, nodePath: current.nodePath };
          }
        }
        continue;
      }

      if (foundDepth !== null && current.path.length >= foundDepth) {
        continue;
      }

      const neighbors = adjacency.get(current.id) || [];
      const sorted = [
        ...neighbors.filter((neighbor) => neighbor.direction !== 'inlaw'),
        ...neighbors.filter((neighbor) => neighbor.direction === 'inlaw'),
      ];
      for (const neighbor of sorted) {
        const canRevisitTarget = (
          neighbor.id === targetId
          && (foundDepth === null || current.path.length + 1 <= foundDepth)
        );
        if (!visited.has(neighbor.id) || canRevisitTarget) {
          visited.add(neighbor.id);
          queue.push({
            id: neighbor.id,
            path: [...current.path, neighbor.direction],
            nodePath: [...current.nodePath, neighbor.id],
          });
        }
      }
    }

    return bestPath;
  }
}
