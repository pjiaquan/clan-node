import type { Person, Relationship } from './types';

// BFS to find path from center to target, then convert to kinship title
export function calculateKinship(
  centerId: string,
  targetId: string,
  relationships: Relationship[],
  people: Person[],
  centerPerson: Person
): { title: string; formalTitle: string } {
  const formatResult = (rawTitle: string) => {
    const trimmed = rawTitle.trim();
    const match = trimmed.match(/^(.*)（(.*)）$/);
    if (match) {
      const colloquial = match[1].trim();
      const formal = match[2].trim();
      return {
        title: colloquial || trimmed,
        formalTitle: formal || trimmed
      };
    }
    return { title: trimmed, formalTitle: trimmed };
  };

  const parentMap = new Map<string, string[]>();
  relationships.forEach(r => {
    if (r.type === 'parent_child') {
      if (!parentMap.has(r.to_person_id)) parentMap.set(r.to_person_id, []);
      parentMap.get(r.to_person_id)?.push(r.from_person_id);
    }
  });

  // Prefer direct ancestor chain (parent-child only) to avoid in-law mislabeling.
  const queueAnc: Array<{ id: string; path: string[]; nodePath: string[] }> = [{
    id: centerId,
    path: [],
    nodePath: [centerId]
  }];
  const visitedAnc = new Set<string>([centerId]);

  while (queueAnc.length > 0) {
    const current = queueAnc.shift()!;
    if (current.id === targetId && current.path.length > 0) {
      return formatResult(pathToTitle(current.path, current.nodePath, centerPerson, people, targetId, relationships));
    }
    const parents = parentMap.get(current.id) || [];
    for (const parentId of parents) {
      if (!visitedAnc.has(parentId)) {
        visitedAnc.add(parentId);
        queueAnc.push({
          id: parentId,
          path: [...current.path, 'up'],
          nodePath: [...current.nodePath, parentId]
        });
      }
    }
  }

  // Build adjacency list for graph traversal
  const adj = new Map<string, Array<{ id: string; type: string; direction: 'up' | 'down' | 'spouse' | 'ex_spouse' | 'sibling' | 'inlaw' }>>();

  for (const r of relationships) {
    if (!r.from_person_id || !r.to_person_id) continue; // Skip invalid relationships

    if (!adj.has(r.from_person_id)) adj.set(r.from_person_id, []);
    if (!adj.has(r.to_person_id)) adj.set(r.to_person_id, []);

    const fromNode = adj.get(r.from_person_id);
    const toNode = adj.get(r.to_person_id);

    if (fromNode && toNode) {
      if (r.type === 'parent_child') {
        fromNode.push({ id: r.to_person_id, type: 'child', direction: 'down' });
        toNode.push({ id: r.from_person_id, type: 'parent', direction: 'up' });
      } else if (r.type === 'spouse') {
        fromNode.push({ id: r.to_person_id, type: 'spouse', direction: 'spouse' });
        toNode.push({ id: r.from_person_id, type: 'spouse', direction: 'spouse' });
      } else if (r.type === 'ex_spouse') {
        fromNode.push({ id: r.to_person_id, type: 'ex_spouse', direction: 'ex_spouse' });
        toNode.push({ id: r.from_person_id, type: 'ex_spouse', direction: 'ex_spouse' });
      } else if (r.type === 'sibling') {
        fromNode.push({ id: r.to_person_id, type: 'sibling', direction: 'sibling' });
        toNode.push({ id: r.from_person_id, type: 'sibling', direction: 'sibling' });
      } else if (r.type === 'in_law') {
        fromNode.push({ id: r.to_person_id, type: 'in_law', direction: 'inlaw' });
        toNode.push({ id: r.from_person_id, type: 'in_law', direction: 'inlaw' });
      }
    }
  }

  // BFS to find shortest path, then prefer fewer in-law hops among shortest paths.
  // queue item: { id, path: directions[], nodePath: nodeIds[] }
  const queue: Array<{ id: string; path: string[]; nodePath: string[] }> = [{
    id: centerId,
    path: [],
    nodePath: [centerId]
  }];
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
        const currentInlawCount = current.path.filter(p => p === 'inlaw').length;
        const bestInlawCount = bestPath
          ? bestPath.path.filter(p => p === 'inlaw').length
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

    const neighbors = adj.get(current.id) || [];
    const sorted = [
      ...neighbors.filter(n => n.direction !== 'inlaw'),
      ...neighbors.filter(n => n.direction === 'inlaw')
    ];
    for (const neighbor of sorted) {
      const canRevisitTarget =
        neighbor.id === targetId && (foundDepth === null || current.path.length + 1 <= foundDepth);
      if (!visited.has(neighbor.id) || canRevisitTarget) {
        visited.add(neighbor.id);
        queue.push({
          id: neighbor.id,
          path: [...current.path, neighbor.direction],
          nodePath: [...current.nodePath, neighbor.id]
        });
      }
    }
  }

  if (bestPath) {
    return formatResult(pathToTitle(bestPath.path, bestPath.nodePath, centerPerson, people, targetId, relationships));
  }

  return formatResult('未知');
}

// Convert path (array of directions) to Chinese kinship title
function pathToTitle(
  path: string[],
  nodePath: string[],
  centerPerson: Person,
  people: Person[],
  targetId: string,
  relationships: Relationship[]
): string {
  const target = people.find(p => p.id === targetId);
  if (!target) return '未知';

  // Helper to get person by ID
  const getPerson = (id: string) => people.find(p => p.id === id);
  const getSiblingRank = (sibling: Person) => {
    const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
    const siblingDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!centerDob || !siblingDob) return null;

    if (siblingDob >= centerDob) {
      return { relation: 'younger', rank: 0 };
    }

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === centerPerson.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === centerPerson.id) siblingIds.add(r.from_person_id);
      }
    });

    const parentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === centerPerson.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && parentIds.includes(r.from_person_id) && r.to_person_id !== centerPerson.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getGrandparentSiblingRank = (grandparent: Person, sibling: Person) => {
    const gpDob = grandparent.dob ? new Date(grandparent.dob).getTime() : 0;
    const sibDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!gpDob || !sibDob) return null;
    if (sibDob >= gpDob) return { relation: 'younger', rank: 0 };

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === grandparent.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === grandparent.id) siblingIds.add(r.from_person_id);
      }
    });

    const parentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === grandparent.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && parentIds.includes(r.from_person_id) && r.to_person_id !== grandparent.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getParentSiblingRank = (parent: Person, sibling: Person) => {
    const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
    const sibDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!parentDob || !sibDob) return null;
    if (sibDob >= parentDob) return { relation: 'younger', rank: 0 };

    const siblingIds = new Set<string>();
    relationships.forEach(r => {
      if (r.type === 'sibling') {
        if (r.from_person_id === parent.id) siblingIds.add(r.to_person_id);
        if (r.to_person_id === parent.id) siblingIds.add(r.from_person_id);
      }
    });

    const grandparentIds = relationships
      .filter(r => r.type === 'parent_child' && r.to_person_id === parent.id)
      .map(r => r.from_person_id);

    relationships
      .filter(r => r.type === 'parent_child' && grandparentIds.includes(r.from_person_id) && r.to_person_id !== parent.id)
      .forEach(r => siblingIds.add(r.to_person_id));

    const sameGenderSiblings = people
      .filter(p => siblingIds.has(p.id) && p.gender === sibling.gender && p.dob)
      .sort((a, b) => new Date(a.dob!).getTime() - new Date(b.dob!).getTime());

    const index = sameGenderSiblings.findIndex(p => p.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  };

  const getInLawSpouseTitle = () => {
    if (target.gender === 'M') return '姻親夫';
    if (target.gender === 'F') return '姻親妻';
    return '姻親';
  };

  const formatDualTitle = (colloquial: string, formal: string) => `${colloquial}（${formal}）`;

  const getCousinInLawTitle = (reference: Person | undefined, cousin: Person | undefined) => {
    if (!reference || !cousin) return '姻親表親配偶';
    const refDob = reference.dob ? new Date(reference.dob).getTime() : 0;
    const cousinDob = cousin.dob ? new Date(cousin.dob).getTime() : 0;
    const isOlder = refDob && cousinDob ? cousinDob < refDob : null;

    if (cousin.gender === 'F') {
      if (isOlder === null) return formatDualTitle('表姐夫/表妹婿', '姻親表姐夫/姻親表妹婿');
      return isOlder ? formatDualTitle('表姐夫', '姻親表姐夫') : formatDualTitle('表妹婿', '姻親表妹婿');
    }
    if (cousin.gender === 'M') {
      if (isOlder === null) return formatDualTitle('表嫂/表弟媳', '姻親表嫂/姻親表弟媳');
      return isOlder ? formatDualTitle('表嫂', '姻親表嫂') : formatDualTitle('表弟媳', '姻親表弟媳');
    }
    return '姻親表親配偶';
  };

  const getInLawElderTitle = () => {
    if (target.gender === 'M') return formatDualTitle('伯父', '姻伯父');
    if (target.gender === 'F') return formatDualTitle('伯母', '姻伯母');
    return formatDualTitle('伯父/伯母', '姻伯父/姻伯母');
  };

  const getUncleAuntieTitle = () => {
    if (target.gender === 'M') return formatDualTitle('Uncle', '姻伯父');
    if (target.gender === 'F') return formatDualTitle('Auntie', '姻伯母');
    return formatDualTitle('Uncle/Auntie', '姻伯父/姻伯母');
  };

  const getParentSiblingSpouseTitle = (parent: Person, auntUncle: Person) => {
    if (parent.gender === 'M') {
      if (auntUncle.gender === 'M') {
        const rank = getParentSiblingRank(parent, auntUncle);
        if (rank?.relation === 'older') {
          if (rank.rank === 1) return '大伯母';
          if (rank.rank === 2) return '二伯母';
          if (rank.rank === 3) return '三伯母';
          if (rank.rank === 4) return '四伯母';
          if (rank.rank === 5) return '五伯母';
          if (rank.rank === 6) return '六伯母';
          if (rank.rank === 7) return '七伯母';
          if (rank.rank === 8) return '八伯母';
          if (rank.rank === 9) return '九伯母';
          if (rank.rank === 10) return '十伯母';
          return `第${rank.rank}伯母`;
        }
        return '嬸嬸';
      }
      return '姑丈';
    }
    if (parent.gender === 'F') {
      if (auntUncle.gender === 'M') {
        return '舅媽';
      }
      return '姨丈';
    }
    return null;
  };

  const getParentInLawSiblingSpouseTitle = (parent: Person | undefined, inLawSibling: Person | undefined) => {
    if (!parent || !inLawSibling) {
      if (target.gender === 'M') return '姻親男長輩';
      if (target.gender === 'F') return '姻親女長輩';
      return '姻親長輩';
    }

    if (parent.gender === 'M') {
      if (inLawSibling.gender === 'M') return '舅婆';
      if (inLawSibling.gender === 'F') return '姨公';
      return target.gender === 'M' ? '姨公' : '舅婆';
    }

    if (parent.gender === 'F') {
      if (inLawSibling.gender === 'M') return '伯婆/嬸婆';
      if (inLawSibling.gender === 'F') return '姑丈公';
      return target.gender === 'M' ? '姑丈公' : '伯婆/嬸婆';
    }

    if (target.gender === 'M') return '姻親男長輩';
    if (target.gender === 'F') return '姻親女長輩';
    return '姻親長輩';
  };

  const pathStr = path.join('-');

  // Self
  if (path.length === 0) return '我';

  const isSpouseOfChild = (parentId: string, personId: string) => {
    const childIds = relationships
      .filter(r => r.type === 'parent_child' && r.from_person_id === parentId)
      .map(r => r.to_person_id);
    for (const childId of childIds) {
      const isSpouse = relationships.some(r =>
        r.type === 'spouse' &&
        ((r.from_person_id === childId && r.to_person_id === personId) ||
         (r.to_person_id === childId && r.from_person_id === personId))
      );
      if (isSpouse) return true;
    }
    return false;
  };

  // Direct relationships
  if (pathStr === 'up' || pathStr === 'sibling-up') return target.gender === 'M' ? '父親' : '母親';
  if (pathStr === 'up-spouse') {
    if (target.gender === 'M') return '父親';
    if (target.gender === 'F') return '母親';
    return '父/母';
  }
  if (pathStr === 'up-ex_spouse') {
    if (target.gender === 'M') return '繼父';
    if (target.gender === 'F') return '繼母';
    return '繼父/繼母';
  }
  if (pathStr === 'down') return target.gender === 'M' ? '兒子' : '女兒';
  if (pathStr === 'spouse') return centerPerson.gender === 'M' ? '妻子' : '丈夫';
  if (pathStr === 'ex_spouse') return centerPerson.gender === 'M' ? '前妻' : '前夫';
  if (pathStr === 'inlaw') {
    if (isSpouseOfChild(centerPerson.id, targetId)) {
      return target.gender === 'M' ? '女婿' : '媳婦';
    }
    if (isSpouseOfChild(targetId, centerPerson.id)) {
      return target.gender === 'M' ? '岳父/公公' : '岳母/婆婆';
    }
    return '姻親';
  }

  // Siblings (up -> down OR explicit sibling)
  if (pathStr === 'up-down' || pathStr === 'sibling' || pathStr === 'sibling-sibling') {
    const rank = getSiblingRank(target);
    if (!rank) return target.gender === 'M' ? '兄弟' : '姊妹';
    if (rank.relation === 'older') {
      const suffix = target.gender === 'M' ? '哥' : '姊';
      if (rank.rank === 1) return `大${suffix}`;
      if (rank.rank === 2) return `二${suffix}`;
      if (rank.rank === 3) return `三${suffix}`;
      if (rank.rank === 4) return `四${suffix}`;
      if (rank.rank === 5) return `五${suffix}`;
      if (rank.rank === 6) return `六${suffix}`;
      if (rank.rank === 7) return `七${suffix}`;
      if (rank.rank === 8) return `八${suffix}`;
      if (rank.rank === 9) return `九${suffix}`;
      if (rank.rank === 10) return `十${suffix}`;
      return `第${rank.rank}${suffix}`;
    }
    return target.gender === 'M' ? '弟弟' : '妹妹';
  }

  // Grandparents (up -> up)
  if (pathStr === 'up-up') {
    const parent = getPerson(nodePath[1]);
    if (parent) {
      if (parent.gender === 'M') { // Father's parents
        return target.gender === 'M' ? '祖父/爺爺' : '祖母/奶奶';
      } else { // Mother's parents
        return target.gender === 'M' ? '外祖父/外公' : '外祖母/外婆';
      }
    }
    // Fallback if parent not found or ambiguous
    if (target.gender === 'M') return '祖父/外祖父';
    return '祖母/外祖母';
  }

  // Great-grandparents and beyond (all ups)
  if (path.length >= 3 && path.every(p => p === 'up')) {
    const ancestorDepth = path.length; // 3 = 曾祖, 4 = 高祖, 5 = 曾高祖, 6 = 玄祖, 7 = 曾玄祖, 8 = 來祖
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    const baseNames = [
      '',
      '',
      '',
      '曾祖',
      '高祖',
      '曾高祖',
      '玄祖',
      '曾玄祖',
      '來祖'
    ];
    const base = baseNames[ancestorDepth] || `第${ancestorDepth - 1}代祖`;
    const prefix = isMaternal ? '外' : '';
    return `${prefix}${base}${target.gender === 'M' ? '父' : '母'}`;
  }

  // Great-grandparents' spouse and beyond (all ups, then spouse)
  if (path.length >= 4 && path.slice(0, -1).every(p => p === 'up') && path[path.length - 1] === 'spouse') {
    const ancestorDepth = path.length - 1;
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    const baseNames = [
      '',
      '',
      '',
      '曾祖',
      '高祖',
      '曾高祖',
      '玄祖',
      '曾玄祖',
      '來祖'
    ];
    const base = baseNames[ancestorDepth] || `第${ancestorDepth - 1}代祖`;
    const prefix = isMaternal ? '外' : '';
    return `${prefix}${base}${target.gender === 'M' ? '父' : '母'}`;
  }

  // Uncles/Aunts (Parent's Sibling)
  // Path can be: up-sibling (explicit) OR up-up-down (via grandparent)
  if (pathStr === 'up-sibling' || pathStr === 'up-up-down') {
    // nodePath[1] is the Parent
    const parent = getPerson(nodePath[1]);
    
    if (parent) {
      if (parent.gender === 'M') { // Father's side
        if (target.gender === 'M') {
          // Father's Brother: Check age relative to Father (parent)
          const rank = getParentSiblingRank(parent, target);
          if (rank?.relation === 'older') {
            if (rank.rank === 1) return '大伯';
            if (rank.rank === 2) return '二伯';
            if (rank.rank === 3) return '三伯';
            if (rank.rank === 4) return '四伯';
            if (rank.rank === 5) return '五伯';
            if (rank.rank === 6) return '六伯';
            if (rank.rank === 7) return '七伯';
            if (rank.rank === 8) return '八伯';
            if (rank.rank === 9) return '九伯';
            if (rank.rank === 10) return '十伯';
            return `第${rank.rank}伯`;
          }
          return '叔叔';
        } else {
          // Father's Sister
          return '姑姑';
        }
      } else { // Mother's side
        if (target.gender === 'M') {
          return '舅舅';
        } else {
          return '阿姨';
        }
      }
    }
  }

  // Grandparent's spouse (父/母 的 父/母 的 夫妻)
  if (pathStr === 'up-up-spouse') {
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    const prefix = isMaternal ? '外' : '';
    return `${prefix}${target.gender === 'M' ? '祖父' : '祖母'}`;
  }

  // Uncle/Aunt's spouse (伯母/嬸嬸/姑丈/舅媽/姨丈)
  if (pathStr === 'up-sibling-spouse' || pathStr === 'up-up-down-spouse') {
    const parent = getPerson(nodePath[1]);
    const auntUncle = getPerson(nodePath[2]);
    if (parent && auntUncle) {
      const title = getParentSiblingSpouseTitle(parent, auntUncle);
      if (title) return title;
    }
  }

  // Uncle/Aunt's ex-spouse (前伯母/前嬸嬸/前姑丈/前舅媽/前姨丈)
  if (pathStr === 'up-sibling-ex_spouse' || pathStr === 'up-up-down-ex_spouse') {
    const parent = getPerson(nodePath[1]);
    const auntUncle = getPerson(nodePath[2]);
    if (parent && auntUncle) {
      const title = getParentSiblingSpouseTitle(parent, auntUncle);
      if (title) return `前${title}`;
    }
    return '前姻親';
  }

  // Parent's sibling's in-law (父/母 的 手足 的 姻親)
  if (pathStr === 'up-sibling-inlaw') {
    const parent = getPerson(nodePath[1]);
    const auntUncle = getPerson(nodePath[2]);
    if (parent && auntUncle) {
      const title = getParentSiblingSpouseTitle(parent, auntUncle);
      if (title) return title;
    }
    return '姻親';
  }

  // Grandparent's in-law (伯母/嬸嬸/姑丈/舅媽/姨丈) via in_law link
  if (pathStr === 'up-up-inlaw') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const spouseChildId = relationships.find(r =>
      r.type === 'spouse' &&
      ((r.from_person_id === targetId && relationships.some(rel => rel.type === 'parent_child' && rel.from_person_id === grandparent?.id && rel.to_person_id === r.to_person_id)) ||
       (r.to_person_id === targetId && relationships.some(rel => rel.type === 'parent_child' && rel.from_person_id === grandparent?.id && rel.to_person_id === r.from_person_id)))
    );
    const spouseChild = spouseChildId
      ? getPerson(spouseChildId.from_person_id === targetId ? spouseChildId.to_person_id : spouseChildId.from_person_id)
      : undefined;

    if (parent && spouseChild) {
      if (parent.gender === 'M') {
        if (spouseChild.gender === 'M') {
          const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
          const uncleDob = spouseChild.dob ? new Date(spouseChild.dob).getTime() : 0;
          if (parentDob && uncleDob) {
            return uncleDob < parentDob ? '伯母' : '嬸嬸';
          }
          return '伯母/嬸嬸';
        }
        return '姑丈';
      }
      if (parent.gender === 'F') {
        if (spouseChild.gender === 'M') return '舅媽';
        return '姨丈';
      }
    }
  }

  // Grand-Uncles/Aunts (Grandparent's Sibling)
  // Path: up-up-sibling OR up-up-up-down
  if (pathStr === 'up-up-sibling' || pathStr === 'up-up-up-down') {
    // nodePath[2] is the Grandparent
    // nodePath[1] is the Parent (determines 'Outer' for some dialects, but usually purely based on Grandparent's gender)
    const grandparent = getPerson(nodePath[2]);
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F'; // Mother's side

    if (grandparent) {
      if (grandparent.gender === 'M') { // Via Grandfather
        if (target.gender === 'M') {
          const rank = getGrandparentSiblingRank(grandparent, target);
          const title = rank?.relation === 'older' ? '伯公' : '叔公';
          if (rank?.relation === 'older') {
            if (rank.rank === 1) return isMaternal ? '外大伯公' : '大伯公';
            if (rank.rank === 2) return isMaternal ? '外二伯公' : '二伯公';
            if (rank.rank === 3) return isMaternal ? '外三伯公' : '三伯公';
          }
          return isMaternal ? `外${title}` : title;
        }
        const title = '姑婆';
        return isMaternal ? `外${title}` : title;
      }
      if (target.gender === 'M') {
        return '舅公';
      }
      return '姨婆';
    }
  }

  // Grand-Uncles/Aunts' spouse
  if (pathStr === 'up-up-sibling-spouse' || pathStr === 'up-up-up-down-spouse') {
    const grandparent = getPerson(nodePath[2]);
    const auntUncle = getPerson(nodePath[3]);
    const parent = getPerson(nodePath[1]);
    const isMaternal = parent?.gender === 'F';
    if (grandparent && auntUncle) {
      if (grandparent.gender === 'M') {
        if (auntUncle.gender === 'M') {
          const rank = getGrandparentSiblingRank(grandparent, auntUncle);
          const base = rank?.relation === 'older' ? '伯婆' : '嬸婆';
          return isMaternal ? `外${base}` : base;
        }
        const base = '姑丈公';
        return isMaternal ? `外${base}` : base;
      }
      if (auntUncle.gender === 'M') {
        return '舅媽';
      }
      return '姨丈';
    }
  }

  // Grandparent's sibling's child (父/母 的 父/母 的 手足 的 子/女)
  if (pathStr === 'up-up-sibling-down' || pathStr === 'up-up-up-down-down') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const gpSiblingIndex = pathStr === 'up-up-sibling-down' ? 3 : 4;
    const grandparentSibling = getPerson(nodePath[gpSiblingIndex]);

    if (parent?.gender === 'M' && grandparent?.gender === 'M' && grandparentSibling?.gender === 'M') {
      const rank = getGrandparentSiblingRank(grandparent, grandparentSibling);
      if (rank?.relation === 'older') {
        if (target.gender === 'M') return '從伯叔';
        if (target.gender === 'F') return '從姑';
        return '從伯叔/從姑';
      }
    }

    if (parent && grandparent && grandparentSibling) {
      const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
      const prefix = isSameSurnameLine ? '堂' : '表';
      if (target.gender === 'M') {
        const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
        const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
        if (parentDob && targetDob) {
          return targetDob < parentDob ? `${prefix}伯` : `${prefix}叔`;
        }
        return `${prefix}伯/叔`;
      }
      if (target.gender === 'F') {
        return `${prefix}姑`;
      }
      return `${prefix}親`;
    }
  }

  // Grandparent's sibling's child's spouse (父/母 的 父/母 的 手足 的 子/女 的 夫妻)
  if (pathStr === 'up-up-sibling-down-spouse' || pathStr === 'up-up-up-down-down-spouse') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const gpSiblingIndex = pathStr === 'up-up-sibling-down-spouse' ? 3 : 4;
    const cousinIndex = pathStr === 'up-up-sibling-down-spouse' ? 4 : 5;
    const grandparentSibling = getPerson(nodePath[gpSiblingIndex]);
    const cousin = getPerson(nodePath[cousinIndex]);

    if (parent && grandparent && grandparentSibling && cousin) {
      const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
      const prefix = isSameSurnameLine ? '堂' : '表';
      if (cousin.gender === 'M') {
        const parentDob = parent.dob ? new Date(parent.dob).getTime() : 0;
        const cousinDob = cousin.dob ? new Date(cousin.dob).getTime() : 0;
        if (parentDob && cousinDob) {
          return cousinDob < parentDob ? `${prefix}伯母` : `${prefix}嬸`;
        }
        return `${prefix}伯母/嬸`;
      }
      if (cousin.gender === 'F') {
        return `${prefix}姑丈`;
      }
      return `${prefix}姻親`;
    }
  }

  // Grandparent's sibling's child's child (父/母 的 父/母 的 手足 的 子/女 的 子/女)
  if (pathStr === 'up-up-sibling-down-down' || pathStr === 'up-up-up-down-down-down') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const gpSiblingIndex = pathStr === 'up-up-sibling-down-down' ? 3 : 4;
    const grandparentSibling = getPerson(nodePath[gpSiblingIndex]);

    if (parent && grandparent && grandparentSibling) {
      const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
      const prefix = isSameSurnameLine ? '再堂' : '再表';
      const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
      const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
      const isOlder = centerDob && targetDob ? targetDob < centerDob : null;
      const genderLabel = target.gender === 'M'
        ? (isOlder === false ? '弟' : '兄')
        : (isOlder === false ? '妹' : '姊');
      if (target.gender === 'M' || target.gender === 'F') {
        return isOlder === null ? `${prefix}兄弟姊妹` : `${prefix}${genderLabel}`;
      }
      return `${prefix}親`;
    }
  }

  // Grandparent's sibling's child's child's spouse (父/母 的 父/母 的 手足 的 子/女 的 子/女 的 夫妻)
  if (pathStr === 'up-up-sibling-down-down-spouse' || pathStr === 'up-up-up-down-down-down-spouse') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const gpSiblingIndex = pathStr === 'up-up-sibling-down-down-spouse' ? 3 : 4;
    const cousinChildIndex = pathStr === 'up-up-sibling-down-down-spouse' ? 5 : 6;
    const grandparentSibling = getPerson(nodePath[gpSiblingIndex]);
    const cousinChild = getPerson(nodePath[cousinChildIndex]);

    if (parent && grandparent && grandparentSibling && cousinChild) {
      const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
      const prefix = isSameSurnameLine ? '再堂' : '再表';
      if (cousinChild.gender === 'M') {
        return `${prefix}姻親`;
      }
      if (cousinChild.gender === 'F') {
        return `${prefix}姻親`;
      }
      return `${prefix}姻親`;
    }
  }

  // Grandparent's sibling's child's child's child (父/母 的 父/母 的 手足 的 子/女 的 子/女 的 子/女)
  if (pathStr === 'up-up-sibling-down-down-down' || pathStr === 'up-up-up-down-down-down-down') {
    const parent = getPerson(nodePath[1]);
    const grandparent = getPerson(nodePath[2]);
    const gpSiblingIndex = pathStr === 'up-up-sibling-down-down-down' ? 3 : 4;
    const grandparentSibling = getPerson(nodePath[gpSiblingIndex]);

    if (parent && grandparent && grandparentSibling) {
      const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
      const prefix = isSameSurnameLine ? '再堂' : '再表';
      if (target.gender === 'M') {
        return `${prefix}甥`;
      }
      if (target.gender === 'F') {
        return `${prefix}甥女`;
      }
      return `${prefix}甥/甥女`;
    }
  }

  // Parent's in-law's sibling (父/母的姻親的手足)
  if (pathStr === 'up-inlaw-sibling' || pathStr === 'up-spouse-up-down' || pathStr === 'up-spouse-sibling') {
    const parent = getPerson(nodePath[1]);
    if (parent) {
      if (parent.gender === 'M') {
        // Father's in-law side -> maternal grandparent's siblings
        return target.gender === 'M' ? '舅公' : '姨婆';
      }
      if (parent.gender === 'F') {
        // Mother's in-law side -> paternal grandparent's siblings
        return target.gender === 'M' ? '伯公/叔公' : '姑婆';
      }
    }
  }

  // Parent's in-law's sibling's child (父/母 的 姻親 的 手足 的 子/女)
  if (pathStr === 'up-inlaw-sibling-down' || pathStr === 'up-spouse-up-down-down' || pathStr === 'up-spouse-sibling-down') {
    if (target.gender === 'M') return '從伯叔';
    if (target.gender === 'F') return '從姑';
    return '從伯叔/從姑';
  }

  // Parent's in-law's sibling's spouse (父/母 的 姻親 的 手足 的 夫妻)
  if (
    pathStr === 'up-inlaw-sibling-spouse'
    || pathStr === 'up-spouse-up-down-spouse'
    || pathStr === 'up-spouse-sibling-spouse'
  ) {
    const parent = getPerson(nodePath[1]);
    const inLawSibling = getPerson(nodePath[nodePath.length - 2]);
    return getParentInLawSiblingSpouseTitle(parent, inLawSibling);
  }

  // Parent's in-law's sibling's child's spouse (父/母 的 姻親 的 手足 的 子/女 的 夫妻)
  if (
    pathStr === 'up-inlaw-sibling-down-spouse'
    || pathStr === 'up-spouse-up-down-down-spouse'
    || pathStr === 'up-spouse-sibling-down-spouse'
  ) {
    const parent = getPerson(nodePath[1]);
    const cousin = getPerson(nodePath[nodePath.length - 2]);
    return getCousinInLawTitle(parent, cousin);
  }

  // Parent's in-law's sibling's child's spouse's child
  // (父/母 的 姻親 的 手足 的 子/女 的 夫妻 的 子/女)
  if (
    pathStr === 'up-inlaw-sibling-down-spouse-down'
    || pathStr === 'up-spouse-up-down-down-spouse-down'
    || pathStr === 'up-spouse-sibling-down-spouse-down'
  ) {
    if (target.gender === 'M') return '姻親表親之子';
    if (target.gender === 'F') return '姻親表親之女';
    return '姻親表親之子/女';
  }

  // Parent's in-law's sibling's child's spouse's grandchild
  // (父/母 的 姻親 的 手足 的 子/女 的 夫妻 的 子/女 的 子/女)
  if (
    pathStr === 'up-inlaw-sibling-down-spouse-down-down'
    || pathStr === 'up-spouse-up-down-down-spouse-down-down'
    || pathStr === 'up-spouse-sibling-down-spouse-down-down'
  ) {
    if (target.gender === 'M') return '姻親表親孫輩(男)';
    if (target.gender === 'F') return '姻親表親孫輩(女)';
    return '姻親表親孫輩';
  }

  // In-law's sibling's child (姻親 的 手足 的 子/女)
  if (pathStr === 'inlaw-sibling-down') {
    return '姻親的子女';
  }

  // Nephews/Nieces and their descendants (Sibling's line)
  // Path: sibling -> down... OR up -> down -> down...
  if (
    pathStr.startsWith('sibling-down') ||
    pathStr.startsWith('sibling-sibling-down') ||
    pathStr.startsWith('up-down-down')
  ) {
    let sibling: Person | undefined;
    let downCount = 0;
    if (pathStr.startsWith('sibling-sibling-down')) {
      sibling = getPerson(nodePath[2]);
      downCount = path.slice(2).filter(p => p === 'down').length;
    } else if (path[0] === 'sibling') {
      sibling = getPerson(nodePath[1]);
      downCount = path.slice(1).filter(p => p === 'down').length;
    } else if (path[0] === 'up' && path[1] === 'down') {
      sibling = getPerson(nodePath[2]);
      downCount = path.slice(2).filter(p => p === 'down').length;
    }

    if (sibling && downCount >= 1) {
      const siblingGender = sibling.gender;
      const targetIsMale = target.gender === 'M';
      const targetIsFemale = target.gender === 'F';

      if (downCount === 1) {
        if (siblingGender === 'M') {
          return targetIsMale ? '姪子' : '姪女';
        }
        if (siblingGender === 'F') {
          return targetIsMale ? '外甥' : '外甥女';
        }
        return targetIsFemale ? '姪/甥女' : '姪/甥';
      }

      if (downCount === 2) {
        if (siblingGender === 'M') {
          return targetIsMale ? '姪孫' : '姪孫女';
        }
        if (siblingGender === 'F') {
          return targetIsMale ? '外甥孫' : '外甥孫女';
        }
        return targetIsFemale ? '姪/甥孫女' : '姪/甥孫';
      }

      const prefixMap = ['', '', '', '曾', '玄', '來', '第六代', '第七代', '第八代'];
      const prefix = prefixMap[downCount] || `第${downCount}代`;
      const base = siblingGender === 'F' ? '外甥孫' : '姪孫';
      const suffix = targetIsMale ? '' : '女';
      return `${prefix}${base}${suffix}`;
    }
  }

  // Grandchildren
  if (pathStr === 'down-down') {
    // Check intermediate child to distinguish Grandson (son's son) vs Outer Grandson (daughter's son)
    const child = getPerson(nodePath[1]);
    if (child) {
      if (child.gender === 'M') {
        return target.gender === 'M' ? '孫子' : '孫女';
      } else {
        return target.gender === 'M' ? '外孫' : '外孫女';
      }
    }
    if (target.gender === 'M') return '孫子/外孫';
    return '孫女/外孫女';
  }

  // Great-grandchildren and beyond (direct descendants)
  if (pathStr === 'down-down-down') {
    return target.gender === 'M' ? '曾孫' : '曾孫女';
  }
  if (pathStr === 'down-down-down-down') {
    return target.gender === 'M' ? '玄孫' : '玄孫女';
  }
  if (pathStr === 'down-down-down-down-down') {
    return target.gender === 'M' ? '來孫' : '來孫女';
  }

  // Child-in-law (down -> spouse)
  if (pathStr === 'down-spouse') {
    return target.gender === 'M' ? '女婿' : '媳婦';
  }

  // Child-in-law's parent (子/女 的 夫妻 的 父/母)
  if (pathStr === 'down-spouse-up' || pathStr === 'down-inlaw-up') {
    return target.gender === 'M' ? '親家公' : '親家婆';
  }

  // Child-in-law's parent's spouse (子/女 的 夫妻 的 父/母 的 夫妻)
  if (pathStr === 'down-spouse-up-spouse' || pathStr === 'down-inlaw-up-spouse') {
    if (target.gender === 'M') return '親家公';
    if (target.gender === 'F') return '親家婆';
    return '親家公/親家婆';
  }

  // Child-in-law's sibling (子/女 的 夫妻 的 手足)
  if (pathStr === 'down-spouse-sibling' || pathStr === 'down-inlaw-sibling') {
    if (target.gender === 'M') return '姻親兄弟';
    if (target.gender === 'F') return '姻親姊妹';
    return '姻親兄弟/姻親姊妹';
  }

  // Child-in-law's sibling's spouse (子/女 的 夫妻 的 手足 的 夫妻)
  if (pathStr === 'down-spouse-sibling-spouse' || pathStr === 'down-inlaw-sibling-spouse') {
    return '姻親';
  }

  // Child-in-law's sibling's child (子/女 的 夫妻 的 手足 的 子/女)
  if (pathStr === 'down-spouse-sibling-down' || pathStr === 'down-inlaw-sibling-down') {
    return '姻親的子女';
  }

  // Sibling-in-law (up -> down -> spouse)
  if (pathStr === 'up-down-spouse' || pathStr === 'sibling-spouse' || pathStr === 'sibling-sibling-inlaw') {
    let sibling: Person | undefined;
    if (pathStr === 'sibling-spouse') {
      sibling = getPerson(nodePath[1]);
    } else if (pathStr === 'sibling-sibling-inlaw') {
      sibling = getPerson(nodePath[2]);
    } else {
      sibling = getPerson(nodePath[2]);
    }

    if (sibling?.gender === 'M') {
      const rank = getSiblingRank(sibling);
      if (rank?.relation === 'older') {
        if (rank.rank === 1) return '大嫂';
        if (rank.rank === 2) return '二嫂';
        if (rank.rank === 3) return '三嫂';
        if (rank.rank === 4) return '四嫂';
        if (rank.rank === 5) return '五嫂';
        if (rank.rank === 6) return '六嫂';
        if (rank.rank === 7) return '七嫂';
        if (rank.rank === 8) return '八嫂';
        if (rank.rank === 9) return '九嫂';
        if (rank.rank === 10) return '十嫂';
        return `第${rank.rank}嫂`;
      }
      return '弟媳';
    }
    if (sibling?.gender === 'F') {
      const rank = getSiblingRank(sibling);
      if (rank?.relation === 'older') {
        if (rank.rank === 1) return '大姐夫';
        if (rank.rank === 2) return '二姐夫';
        if (rank.rank === 3) return '三姐夫';
        if (rank.rank === 4) return '四姐夫';
        if (rank.rank === 5) return '五姐夫';
        if (rank.rank === 6) return '六姐夫';
        if (rank.rank === 7) return '七姐夫';
        if (rank.rank === 8) return '八姐夫';
        if (rank.rank === 9) return '九姐夫';
        if (rank.rank === 10) return '十姐夫';
        return `第${rank.rank}姐夫`;
      }
      return '妹夫';
    }
    if (target.gender === 'M') return '姊夫/妹夫';
    return '嫂嫂/弟媳';
  }

  if (pathStr === 'up-inlaw') {
    if (target.gender === 'M') return '姊夫/妹夫';
    return '嫂嫂/弟媳';
  }

  if (pathStr === 'up-inlaw-down') {
    return target.gender === 'M' ? '姪子' : '姪女';
  }

  if (pathStr === 'up-inlaw-down-down') {
    return target.gender === 'M' ? '姪孫' : '姪孫女';
  }

  if (pathStr === 'up-inlaw-inlaw') {
    const parent = getPerson(nodePath[1]);
    if (parent) {
      if (parent.gender === 'M') {
        if (target.gender === 'M') {
          const rank = getParentSiblingRank(parent, target);
          if (rank?.relation === 'older') {
            if (rank.rank === 1) return '大伯';
            if (rank.rank === 2) return '二伯';
            if (rank.rank === 3) return '三伯';
            if (rank.rank === 4) return '四伯';
            if (rank.rank === 5) return '五伯';
            if (rank.rank === 6) return '六伯';
            if (rank.rank === 7) return '七伯';
            if (rank.rank === 8) return '八伯';
            if (rank.rank === 9) return '九伯';
            if (rank.rank === 10) return '十伯';
            return `第${rank.rank}伯`;
          }
          return '叔叔';
        }
        return '姑姑';
      }
      if (target.gender === 'M') {
        return '舅舅';
      }
      return '阿姨';
    }
  }

  // Parent's sibling's spouse via in-law chain
  if (pathStr === 'up-inlaw-inlaw') {
    const parent = getPerson(nodePath[1]);
    const possibleSibling = getPerson(nodePath[2]);
    const possibleSpouse = getPerson(nodePath[3]);
    if (parent && possibleSibling && possibleSpouse) {
      const parentIds = relationships
        .filter(r => r.type === 'parent_child' && r.to_person_id === parent.id)
        .map(r => r.from_person_id);
      const siblingParentIds = relationships
        .filter(r => r.type === 'parent_child' && r.to_person_id === possibleSibling.id)
        .map(r => r.from_person_id);
      const sharesParent = parentIds.some(id => siblingParentIds.includes(id));
      const isSpouse = relationships.some(r =>
        r.type === 'spouse' &&
        ((r.from_person_id === possibleSibling.id && r.to_person_id === possibleSpouse.id) ||
         (r.to_person_id === possibleSibling.id && r.from_person_id === possibleSpouse.id))
      );

      if (sharesParent && isSpouse) {
        const title = getParentSiblingSpouseTitle(parent, possibleSibling);
        if (title) return title;
      }
    }
  }

  if (pathStr === 'down-inlaw') {
    return target.gender === 'M' ? '女婿' : '媳婦';
  }
  
  // Spouse's sibling (spouse -> up -> down) OR spouse -> sibling
  if (pathStr === 'spouse-up-down' || pathStr === 'spouse-sibling') {
    if (target.gender === 'M') return '大伯/小叔/內兄/內弟';
    return '姑嫂';
  }

  // Spouse's parent's sibling's child (岳父/岳母 的 手足 的 子/女)
  if (pathStr === 'spouse-up-sibling-down' || pathStr === 'spouse-up-up-down-down') {
    return '姻親表親';
  }

  // Spouse's sibling's child
  if (pathStr === 'spouse-sibling-down' || pathStr === 'spouse-up-down-down') {
    if (target.gender === 'M') return '姪子/外甥(姻)';
    return '姪女/外甥女(姻)';
  }

  // Spouse's sibling's grandchild (夫妻 的 手足 的 子/女 的 子/女)
  if (pathStr === 'spouse-sibling-down-down' || pathStr === 'spouse-up-down-down-down') {
    if (target.gender === 'M') return '姻親孫';
    if (target.gender === 'F') return '姻親孫女';
    return '姻親孫/孫女';
  }

  // Spouse's sibling's child's spouse
  if (pathStr === 'spouse-sibling-down-spouse' || pathStr === 'spouse-up-down-down-spouse') {
    if (target.gender === 'M') return '姪女婿/外甥女婿';
    if (target.gender === 'F') return '姪媳/外甥媳';
    return '姪媳/姪女婿';
  }

  // Siblings (same parents, requires checking if share parents)
  if (pathStr === 'spouse-down') {
    // Spouse's child (step-child)
    return target.gender === 'M' ? '繼子' : '繼女';
  }

  // Parent's siblings
  if (pathStr.startsWith('up-spouse') || pathStr.startsWith('up-down-spouse')) { // This logic was a bit fuzzy in old version
    // up-up-down is uncle/aunt
  }

  // Handle up-up-down (grandparent's child = parent's sibling)
  if (pathStr === 'up-up-down') {
    if (target.gender === 'M') return '伯父/叔叔/舅舅';
    return '姑姑/阿姨';
  }
  
  // Parent-in-law (spouse -> up)
  if (pathStr === 'spouse-up') {
    if (target.gender === 'M') return '岳父/公公';
    return '岳母/婆婆';
  }

  // Parent-in-law's sibling (夫妻 的 父/母 的 手足)
  if (pathStr === 'spouse-up-sibling' || pathStr === 'spouse-up-up-down') {
    const spouse = getPerson(nodePath[1]);
    const inLawParent = getPerson(nodePath[2]);
    if (centerPerson.gender === 'M') {
      if (target.gender === 'M' && inLawParent) {
        const rank = getParentSiblingRank(inLawParent, target);
        if (rank?.relation === 'older') return '岳伯';
        return '岳叔';
      }
      if (target.gender === 'F') return '岳姑';
      return '岳伯/岳叔';
    }
    if (centerPerson.gender === 'F') {
      if (target.gender === 'M' && inLawParent) {
        const rank = getParentSiblingRank(inLawParent, target);
        if (rank?.relation === 'older') return '公伯';
        if (rank) return '公叔';
        return '公伯/公叔';
      }
      if (target.gender === 'F') return '婆姑';
      return '公伯/公叔';
    }
    return target.gender === 'M' ? '姻親伯叔' : '姻親姑';
  }

  // Parent-in-law's sibling's spouse (夫妻 的 父/母 的 手足 的 夫妻)
  if (pathStr === 'spouse-up-sibling-spouse' || pathStr === 'spouse-up-up-down-spouse') {
    const inLawParent = getPerson(nodePath[2]);
    const inLawSibling = getPerson(nodePath[3]);
    const inLawSiblingRank = inLawParent && inLawSibling
      ? getParentSiblingRank(inLawParent, inLawSibling)
      : null;
    const isOlder = inLawSiblingRank?.relation === 'older';
    if (centerPerson.gender === 'M') {
      if (target.gender === 'M') return '岳姑丈';
      if (target.gender === 'F') return isOlder === undefined ? '岳伯母/岳嬸' : (isOlder ? '岳伯母' : '岳嬸');
      return '岳伯母/岳嬸';
    }
    if (centerPerson.gender === 'F') {
      if (target.gender === 'M') return '婆姑丈';
      if (target.gender === 'F') return isOlder === undefined ? '公伯母/公嬸' : (isOlder ? '公伯母' : '公嬸');
      return '公伯母/公嬸';
    }
    return '姻親';
  }

  // Parent-in-law's sibling's child's spouse (夫妻 的 父/母 的 手足 的 子/女 的 夫妻)
  if (pathStr === 'spouse-up-sibling-down-spouse' || pathStr === 'spouse-up-up-down-down-spouse') {
    const inLaw = getPerson(nodePath[1]);
    const cousin = getPerson(nodePath[pathStr === 'spouse-up-sibling-down-spouse' ? 4 : 5]);
    return getCousinInLawTitle(inLaw, cousin);
  }

  // Sibling-in-law's in-law cousin's spouse (手足 的 夫妻 的 父/母 的 手足 的 子/女 的 夫妻)
  if (pathStr === 'sibling-spouse-up-sibling-down-spouse' || pathStr === 'up-down-spouse-up-sibling-down-spouse') {
    const inLaw = getPerson(nodePath[pathStr === 'sibling-spouse-up-sibling-down-spouse' ? 2 : 3]);
    const cousin = getPerson(nodePath[pathStr === 'sibling-spouse-up-sibling-down-spouse' ? 5 : 6]);
    return getCousinInLawTitle(inLaw, cousin);
  }

  // Parent-in-law's sibling's grandchild (夫妻 的 父/母 的 手足 的 子/女 的 子/女)
  if (pathStr === 'spouse-up-sibling-down-down' || pathStr === 'spouse-up-up-down-down-down') {
    return '姻親表親';
  }

  // Parent-in-law's sibling's grandchild's spouse (夫妻 的 父/母 的 手足 的 子/女 的 子/女 的 夫妻)
  if (pathStr === 'spouse-up-sibling-down-down-spouse' || pathStr === 'spouse-up-up-down-down-down-spouse') {
    return '姻親表親的配偶';
  }

  // Parent-in-law's sibling's great-grandchild (夫妻 的 父/母 的 手足 的 子/女 的 子/女 的 子/女)
  if (pathStr === 'spouse-up-sibling-down-down-down' || pathStr === 'spouse-up-up-down-down-down-down') {
    return '姻親表親的子女';
  }

  // Parents-in-law's parents (岳祖父/岳祖母)
  if (pathStr === 'spouse-up-up') {
    if (centerPerson.gender === 'M') {
      return target.gender === 'M' ? '岳祖父' : '岳祖母';
    }
    if (centerPerson.gender === 'F') {
      return target.gender === 'M' ? '夫祖父' : '夫祖母';
    }
    return target.gender === 'M' ? '配偶祖父' : '配偶祖母';
  }

  // Parents-in-law's parents' spouse (夫妻 的 父/母 的 父/母 的 夫妻)
  if (pathStr === 'spouse-up-up-spouse') {
    if (centerPerson.gender === 'M') {
      return target.gender === 'M' ? '岳祖父' : '岳祖母';
    }
    if (centerPerson.gender === 'F') {
      return target.gender === 'M' ? '夫祖父' : '夫祖母';
    }
    return target.gender === 'M' ? '配偶祖父' : '配偶祖母';
  }

  // Cousins (parent's sibling's child: up-up-down-down or up-sibling-down)
  if (pathStr === 'up-up-down-down' || pathStr === 'up-sibling-down') {
     const parent = getPerson(nodePath[1]);
     const auntUncle = pathStr === 'up-sibling-down' ? getPerson(nodePath[2]) : getPerson(nodePath[2]);
     const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
     const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
     const isOlder = centerDob && targetDob ? targetDob < centerDob : null;
     const genderLabel = target.gender === 'M'
       ? (isOlder === false ? '弟' : '兄')
       : (isOlder === false ? '妹' : '姊');

     if (parent && auntUncle) {
       const isFather = parent.gender === 'M';
       const isPaternalBrother = isFather && auntUncle.gender === 'M';
       if (isPaternalBrother) {
         return isOlder === null
           ? (target.gender === 'M' ? '堂兄弟' : '堂姊妹')
           : `堂${genderLabel}`;
       }
       return isOlder === null
         ? (target.gender === 'M' ? '表兄弟' : '表姊妹')
         : `表${genderLabel}`;
     }

     return '堂/表兄弟姊妹';
  }

  // Cousin's child (堂/表兄弟姊妹的兒女)
  if (pathStr === 'up-up-down-down-down' || pathStr === 'up-sibling-down-down') {
    const parent = getPerson(nodePath[1]);
    const auntUncleIndex = pathStr === 'up-sibling-down-down' ? 2 : 3;
    const auntUncle = getPerson(nodePath[auntUncleIndex]);
    const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
    const male = target.gender === 'M';
    const female = target.gender === 'F';
    if (isPaternalBrother) {
      if (male) return '堂甥';
      if (female) return '堂甥女';
      return '堂甥/堂甥女';
    }
    if (male) return '表甥';
    if (female) return '表甥女';
    return '表甥/表甥女';
  }

  // Cousin's grandchild (堂/表甥的兒女)
  if (pathStr === 'up-up-down-down-down-down' || pathStr === 'up-sibling-down-down-down') {
    const parent = getPerson(nodePath[1]);
    const auntUncleIndex = pathStr === 'up-sibling-down-down-down' ? 2 : 3;
    const auntUncle = getPerson(nodePath[auntUncleIndex]);
    const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
    const male = target.gender === 'M';
    const female = target.gender === 'F';
    if (isPaternalBrother) {
      if (male) return '堂曾甥';
      if (female) return '堂曾甥女';
      return '堂曾甥/堂曾甥女';
    }
    if (male) return '表曾甥';
    if (female) return '表曾甥女';
    return '表曾甥/表曾甥女';
  }

  // Cousin's child's spouse (堂/表甥的配偶)
  if (pathStr === 'up-up-down-down-down-spouse' || pathStr === 'up-sibling-down-down-spouse') {
    const parent = getPerson(nodePath[1]);
    const auntUncleIndex = pathStr === 'up-sibling-down-down-spouse' ? 2 : 3;
    const cousinChildIndex = pathStr === 'up-sibling-down-down-spouse' ? 4 : 5;
    const auntUncle = getPerson(nodePath[auntUncleIndex]);
    const cousinChild = getPerson(nodePath[cousinChildIndex]);
    const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
    if (cousinChild?.gender === 'M') {
      return isPaternalBrother ? '堂甥媳' : '表甥媳';
    }
    if (cousinChild?.gender === 'F') {
      return isPaternalBrother ? '堂甥女婿' : '表甥女婿';
    }
    return isPaternalBrother ? '堂甥媳/堂甥女婿' : '表甥媳/表甥女婿';
  }

  // Cousin's child's spouse's parent (堂/表甥媳、甥女婿的父母)
  if (pathStr === 'up-up-down-down-down-spouse-up' || pathStr === 'up-sibling-down-down-spouse-up') {
    const parent = getPerson(nodePath[1]);
    const auntUncleIndex = pathStr === 'up-sibling-down-down-spouse-up' ? 2 : 3;
    const auntUncle = getPerson(nodePath[auntUncleIndex]);
    const cousinChildIndex = pathStr === 'up-sibling-down-down-spouse-up' ? 4 : 5;
    const cousinChild = getPerson(nodePath[cousinChildIndex]);
    const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
    if (cousinChild?.gender === 'M') {
      return isPaternalBrother ? '堂甥媳的父母' : '表甥媳的父母';
    }
    if (cousinChild?.gender === 'F') {
      return isPaternalBrother ? '堂甥女婿的父母' : '表甥女婿的父母';
    }
    return isPaternalBrother ? '堂甥媳/堂甥女婿的父母' : '表甥媳/表甥女婿的父母';
  }

  // Cousin's spouse (表兄弟姊妹的配偶)
  if (pathStr === 'up-up-down-down-spouse' || pathStr === 'up-sibling-down-spouse') {
    const cousinIndex = pathStr === 'up-sibling-down-spouse' ? 3 : 4;
    const auntUncleIndex = pathStr === 'up-sibling-down-spouse' ? 2 : 3;
    const parent = getPerson(nodePath[1]);
    const auntUncle = getPerson(nodePath[auntUncleIndex]);
    const cousin = getPerson(nodePath[cousinIndex]);
    const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
    const cousinDob = cousin?.dob ? new Date(cousin.dob).getTime() : 0;
    const isOlder = centerDob && cousinDob ? cousinDob < centerDob : null;
    const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';

    if (cousin?.gender === 'M') {
      if (isOlder === null) return isPaternalBrother ? '堂兄弟媳' : '表兄弟媳';
      return isPaternalBrother ? (isOlder ? '堂嫂' : '堂弟媳') : (isOlder ? '表嫂' : '表弟媳');
    }
    if (cousin?.gender === 'F') {
      if (isOlder === null) return isPaternalBrother ? '堂姊妹夫' : '表姊妹夫';
      return isPaternalBrother ? (isOlder ? '堂姊夫' : '堂妹夫') : (isOlder ? '表姊夫' : '表妹夫');
    }
    return target.gender === 'M'
      ? (isPaternalBrother ? '堂姊夫/堂妹夫' : '表姊夫/表妹夫/表妹婿')
      : (isPaternalBrother ? '堂嫂/堂弟媳' : '表嫂/表弟媳/表弟妹');
  }

  // Sibling's Spouse's Sibling (Sister-in-law/Brother-in-law's sibling)
  if (pathStr === 'up-down-spouse-sibling' || pathStr === 'sibling-spouse-sibling') {
    let linkingSibling: Person | undefined;
    if (pathStr === 'sibling-spouse-sibling') {
        linkingSibling = getPerson(nodePath[1]);
    } else {
        linkingSibling = getPerson(nodePath[2]);
    }

    if (linkingSibling) {
        const centerDob = centerPerson.dob ? new Date(centerPerson.dob).getTime() : 0;
        const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
        
        if (target.gender === 'M') {
             if (centerDob && targetDob) {
                 return targetDob < centerDob ? '親家大哥' : '親家弟弟';
             }
             return '親家兄弟';
        } else {
             if (centerDob && targetDob) {
                 return targetDob < centerDob ? '親家大姊' : '親家妹妹';
             }
             return '親家姊妹';
        }
    }
  }

  // Sibling's spouse's sibling's spouse (手足 的 夫妻 的 手足 的 夫妻)
  if (pathStr === 'up-down-spouse-sibling-spouse' || pathStr === 'sibling-spouse-sibling-spouse') {
    return '姻親';
  }

  // Spouse's sibling's spouse (夫妻 的 手足 的 夫妻)
  if (pathStr === 'spouse-sibling-spouse' || pathStr === 'spouse-up-down-spouse') {
    return '姻親';
  }

  // Sibling's spouse's sibling's child (手足 的 夫妻 的 手足 的 子/女)
  if (pathStr === 'up-down-spouse-sibling-down' || pathStr === 'sibling-spouse-sibling-down') {
    return '姻親的子女';
  }

  // Sibling's spouse's sibling's child's sibling
  // (手足 的 夫妻 的 手足 的 子/女 的 手足)
  if (
    pathStr === 'up-down-spouse-sibling-down-sibling'
    || pathStr === 'sibling-spouse-sibling-down-sibling'
  ) {
    const inLawChild = getPerson(nodePath[nodePath.length - 2]);
    const inLawChildDob = inLawChild?.dob ? new Date(inLawChild.dob).getTime() : 0;
    const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
    const hasComparableDob = Boolean(inLawChildDob && targetDob);
    const isOlder = hasComparableDob ? targetDob < inLawChildDob : null;

    if (target.gender === 'M') {
      if (isOlder === true) return '姻親的兄';
      if (isOlder === false) return '姻親的弟';
      return '姻親的兄/弟';
    }
    if (target.gender === 'F') {
      if (isOlder === true) return '姻親的姐姐';
      if (isOlder === false) return '姻親的妹妹';
      return '姻親的姐姐/妹妹';
    }
    return '姻親的手足';
  }

  // Sibling's spouse's parent (手足 的 夫妻 的 父/母)
  if (pathStr === 'sibling-spouse-up' || pathStr === 'up-down-spouse-up') {
    return getUncleAuntieTitle();
  }

  // Sibling's spouse's parent's spouse (手足 的 夫妻 的 父/母 的 夫妻)
  if (pathStr === 'sibling-spouse-up-spouse' || pathStr === 'up-down-spouse-up-spouse') {
    return '姻親父母';
  }

  // Sibling's spouse's parent's sibling's spouse (手足 的 夫妻 的 父/母 的 手足 的 夫妻)
  if (pathStr === 'sibling-spouse-up-sibling-spouse' || pathStr === 'up-down-spouse-up-sibling-spouse') {
    return getUncleAuntieTitle();
  }

  // Sibling's spouse's parent's sibling's child (手足 的 夫妻 的 父/母 的 手足 的 子/女)
  if (pathStr === 'sibling-spouse-up-sibling-down' || pathStr === 'up-down-spouse-up-sibling-down') {
    if (target.gender === 'M') return formatDualTitle('表兄弟', '姻親表兄弟');
    if (target.gender === 'F') return formatDualTitle('表姊妹', '姻親表姊妹');
    return formatDualTitle('表兄弟/表姊妹', '姻親表親');
  }

  // Two-level in-law elders ("親家的親家" 長輩)
  const inlawSteps = path.filter(p => p === 'spouse' || p === 'inlaw' || p === 'ex_spouse').length;
  if (path[path.length - 1] === 'up' && inlawSteps >= 2) {
    return getInLawElderTitle();
  }

  // Default: show path for debugging in Chinese
  const chinesePath = path.map(p => {
    switch (p) {
      case 'up': return '父/母';
      case 'down': return '子/女';
      case 'spouse': return '夫妻';
      case 'sibling': return '手足';
      case 'ex_spouse': return '前夫/前妻';
      case 'inlaw': return '姻親';
      default: return p;
    }
  }).join(' 的 ');
  return chinesePath;
}
