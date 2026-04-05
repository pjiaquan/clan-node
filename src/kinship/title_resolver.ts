import type { Person, Relationship } from '../types';
import { SiblingRankComputer } from './rank_computer';

type ResolveInput = {
  path: string[];
  nodePath: string[];
  targetId: string;
};

type ResolveState = ResolveInput & {
  pathStr: string;
  target: Person;
};

export class KinshipTitleResolver {
  private readonly rankComputer: SiblingRankComputer;

  constructor(
    private readonly centerPerson: Person,
    private readonly people: Person[],
    private readonly relationships: Relationship[],
  ) {
    this.rankComputer = new SiblingRankComputer(people, relationships);
  }

  resolve({ path, nodePath, targetId }: ResolveInput): string {
    const target = this.getPerson(targetId);
    if (!target) return '未知';

    const state: ResolveState = {
      path,
      nodePath,
      targetId,
      pathStr: path.join('-'),
      target,
    };

    const handlers = [
      this.resolveSelfAndDirect,
      this.resolveAncestorLine,
      this.resolveParentLine,
      this.resolveGrandparentLine,
      this.resolveInLawBridgeLine,
      this.resolveSiblingDescendantLine,
      this.resolveDescendantLine,
      this.resolveSiblingInLawLine,
      this.resolveSpouseLine,
      this.resolveCousinLine,
      this.resolveExtendedInLawLine,
    ];

    for (const handler of handlers) {
      const title = handler.call(this, state);
      if (title) return title;
    }

    return this.resolveFallback(state.path);
  }

  private getPerson(id: string | undefined) {
    if (!id) return undefined;
    return this.people.find((person) => person.id === id);
  }

  private formatDualTitle(colloquial: string, formal: string) {
    return `${colloquial}（${formal}）`;
  }

  private formatDebugPath(path: string[]) {
    return path.map((segment) => {
      switch (segment) {
        case 'up': return '父/母';
        case 'down': return '子/女';
        case 'spouse': return '夫妻';
        case 'sibling': return '手足';
        case 'ex_spouse': return '前夫/前妻';
        case 'inlaw': return '姻親';
        default: return segment;
      }
    }).join(' 的 ');
  }

  private getNumberedTitle(rank: number, baseTitles: string[], fallbackSuffix: string) {
    if (rank >= 1 && rank <= 10) {
      return baseTitles[rank - 1] ?? `第${rank}${fallbackSuffix}`;
    }
    return `第${rank}${fallbackSuffix}`;
  }

  private getSiblingRank(sibling: Person) {
    return this.rankComputer.getSiblingRank(this.centerPerson, sibling);
  }

  private getParentSiblingRank(parent: Person, sibling: Person) {
    return this.rankComputer.getParentSiblingRank(parent, sibling);
  }

  private getGrandparentSiblingRank(grandparent: Person, sibling: Person) {
    return this.rankComputer.getGrandparentSiblingRank(grandparent, sibling);
  }

  private isSpouseOfChild(parentId: string, personId: string) {
    const childIds = this.relationships
      .filter((relationship) => relationship.type === 'parent_child' && relationship.from_person_id === parentId)
      .map((relationship) => relationship.to_person_id);
    for (const childId of childIds) {
      const isSpouse = this.relationships.some((relationship) => (
        relationship.type === 'spouse'
        && ((relationship.from_person_id === childId && relationship.to_person_id === personId)
          || (relationship.to_person_id === childId && relationship.from_person_id === personId))
      ));
      if (isSpouse) return true;
    }
    return false;
  }

  private getInLawElderTitle(target: Person) {
    if (target.gender === 'M') return this.formatDualTitle('伯父', '姻伯父');
    if (target.gender === 'F') return this.formatDualTitle('伯母', '姻伯母');
    return this.formatDualTitle('伯父/伯母', '姻伯父/姻伯母');
  }

  private getUncleAuntieTitle(target: Person) {
    if (target.gender === 'M') return this.formatDualTitle('Uncle', '姻伯父');
    if (target.gender === 'F') return this.formatDualTitle('Auntie', '姻伯母');
    return this.formatDualTitle('Uncle/Auntie', '姻伯父/姻伯母');
  }

  private getCousinInLawTitle(reference: Person | undefined, cousin: Person | undefined) {
    if (!reference || !cousin) return '姻親表親配偶';
    const referenceDob = reference.dob ? new Date(reference.dob).getTime() : 0;
    const cousinDob = cousin.dob ? new Date(cousin.dob).getTime() : 0;
    const isOlder = referenceDob && cousinDob ? cousinDob < referenceDob : null;

    if (cousin.gender === 'F') {
      if (isOlder === null) return this.formatDualTitle('表姐夫/表妹婿', '姻親表姐夫/姻親表妹婿');
      return isOlder ? this.formatDualTitle('表姐夫', '姻親表姐夫') : this.formatDualTitle('表妹婿', '姻親表妹婿');
    }
    if (cousin.gender === 'M') {
      if (isOlder === null) return this.formatDualTitle('表嫂/表弟媳', '姻親表嫂/姻親表弟媳');
      return isOlder ? this.formatDualTitle('表嫂', '姻親表嫂') : this.formatDualTitle('表弟媳', '姻親表弟媳');
    }
    return '姻親表親配偶';
  }

  private getParentSiblingSpouseTitle(parent: Person, auntUncle: Person) {
    if (parent.gender === 'M') {
      if (auntUncle.gender === 'M') {
        const rank = this.getParentSiblingRank(parent, auntUncle);
        if (rank?.relation === 'older') {
          return this.getNumberedTitle(rank.rank, ['大伯母', '二伯母', '三伯母', '四伯母', '五伯母', '六伯母', '七伯母', '八伯母', '九伯母', '十伯母'], '伯母');
        }
        return '嬸嬸';
      }
      return '姑丈';
    }
    if (parent.gender === 'F') {
      if (auntUncle.gender === 'M') return '舅媽';
      return '姨丈';
    }
    return null;
  }

  private getParentInLawSiblingSpouseTitle(parent: Person | undefined, inLawSibling: Person | undefined, target: Person) {
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
  }

  private resolveSelfAndDirect(state: ResolveState) {
    const { path, pathStr, target, targetId } = state;

    if (path.length === 0) return '我';
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
    if (pathStr === 'spouse') return this.centerPerson.gender === 'M' ? '妻子' : '丈夫';
    if (pathStr === 'ex_spouse') return this.centerPerson.gender === 'M' ? '前妻' : '前夫';
    if (pathStr === 'inlaw') {
      if (this.isSpouseOfChild(this.centerPerson.id, targetId)) {
        return target.gender === 'M' ? '女婿' : '媳婦';
      }
      if (this.isSpouseOfChild(targetId, this.centerPerson.id)) {
        return target.gender === 'M' ? '岳父/公公' : '岳母/婆婆';
      }
      return '姻親';
    }
    if (pathStr === 'up-down' || pathStr === 'sibling' || pathStr === 'sibling-sibling') {
      const rank = this.getSiblingRank(target);
      if (!rank) return target.gender === 'M' ? '兄弟' : '姊妹';
      if (rank.relation === 'older') {
        const suffix = target.gender === 'M' ? '哥' : '姊';
        return this.getNumberedTitle(rank.rank, [`大${suffix}`, `二${suffix}`, `三${suffix}`, `四${suffix}`, `五${suffix}`, `六${suffix}`, `七${suffix}`, `八${suffix}`, `九${suffix}`, `十${suffix}`], suffix);
      }
      return target.gender === 'M' ? '弟弟' : '妹妹';
    }
    return null;
  }

  private resolveAncestorLine(state: ResolveState) {
    const { path, pathStr, nodePath, target } = state;
    if (pathStr === 'up-up') {
      const parent = this.getPerson(nodePath[1]);
      if (parent) {
        if (parent.gender === 'M') {
          return target.gender === 'M' ? '祖父/爺爺' : '祖母/奶奶';
        }
        return target.gender === 'M' ? '外祖父/外公' : '外祖母/外婆';
      }
      if (target.gender === 'M') return '祖父/外祖父';
      return '祖母/外祖母';
    }

    if (path.length >= 3 && path.every((segment) => segment === 'up')) {
      const ancestorDepth = path.length;
      const parent = this.getPerson(nodePath[1]);
      const isMaternal = parent?.gender === 'F';
      const baseNames = ['', '', '', '曾祖', '高祖', '曾高祖', '玄祖', '曾玄祖', '來祖'];
      const base = baseNames[ancestorDepth] || `第${ancestorDepth - 1}代祖`;
      const prefix = isMaternal ? '外' : '';
      return `${prefix}${base}${target.gender === 'M' ? '父' : '母'}`;
    }

    if (path.length >= 4 && path.slice(0, -1).every((segment) => segment === 'up') && path[path.length - 1] === 'spouse') {
      const ancestorDepth = path.length - 1;
      const parent = this.getPerson(nodePath[1]);
      const isMaternal = parent?.gender === 'F';
      const baseNames = ['', '', '', '曾祖', '高祖', '曾高祖', '玄祖', '曾玄祖', '來祖'];
      const base = baseNames[ancestorDepth] || `第${ancestorDepth - 1}代祖`;
      const prefix = isMaternal ? '外' : '';
      return `${prefix}${base}${target.gender === 'M' ? '父' : '母'}`;
    }

    if (pathStr === 'up-up-spouse') {
      const parent = this.getPerson(nodePath[1]);
      const isMaternal = parent?.gender === 'F';
      const prefix = isMaternal ? '外' : '';
      return `${prefix}${target.gender === 'M' ? '祖父' : '祖母'}`;
    }

    return null;
  }

  private resolveParentLine(state: ResolveState) {
    const { pathStr, nodePath, target, targetId } = state;

    if (pathStr === 'up-sibling' || pathStr === 'up-up-down') {
      const parent = this.getPerson(nodePath[1]);
      if (parent) {
        if (parent.gender === 'M') {
          if (target.gender === 'M') {
            const rank = this.getParentSiblingRank(parent, target);
            if (rank?.relation === 'older') {
              return this.getNumberedTitle(rank.rank, ['大伯', '二伯', '三伯', '四伯', '五伯', '六伯', '七伯', '八伯', '九伯', '十伯'], '伯');
            }
            return '叔叔';
          }
          return '姑姑';
        }
        if (target.gender === 'M') return '舅舅';
        return '阿姨';
      }
    }

    if (pathStr === 'up-sibling-spouse' || pathStr === 'up-up-down-spouse') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[2]);
      if (parent && auntUncle) {
        const title = this.getParentSiblingSpouseTitle(parent, auntUncle);
        if (title) return title;
      }
    }

    if (pathStr === 'up-sibling-ex_spouse' || pathStr === 'up-up-down-ex_spouse') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[2]);
      if (parent && auntUncle) {
        const title = this.getParentSiblingSpouseTitle(parent, auntUncle);
        if (title) return `前${title}`;
      }
      return '前姻親';
    }

    if (pathStr === 'up-sibling-inlaw') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[2]);
      if (parent && auntUncle) {
        const title = this.getParentSiblingSpouseTitle(parent, auntUncle);
        if (title) return title;
      }
      return '姻親';
    }

    if (pathStr === 'up-up-inlaw') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const spouseChildRelationship = this.relationships.find((relationship) => (
        relationship.type === 'spouse'
        && ((relationship.from_person_id === target.id
          && this.relationships.some((candidate) => candidate.type === 'parent_child' && candidate.from_person_id === grandparent?.id && candidate.to_person_id === relationship.to_person_id))
        || (relationship.to_person_id === target.id
          && this.relationships.some((candidate) => candidate.type === 'parent_child' && candidate.from_person_id === grandparent?.id && candidate.to_person_id === relationship.from_person_id)))
      ));
      const spouseChild = spouseChildRelationship
        ? this.getPerson(spouseChildRelationship.from_person_id === target.id ? spouseChildRelationship.to_person_id : spouseChildRelationship.from_person_id)
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

    return null;
  }

  private resolveGrandparentLine(state: ResolveState) {
    const { pathStr, nodePath, target } = state;

    if (pathStr === 'up-up-sibling' || pathStr === 'up-up-up-down') {
      const grandparent = this.getPerson(nodePath[2]);
      const parent = this.getPerson(nodePath[1]);
      const isMaternal = parent?.gender === 'F';

      if (grandparent) {
        if (grandparent.gender === 'M') {
          if (target.gender === 'M') {
            const rank = this.getGrandparentSiblingRank(grandparent, target);
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
        if (target.gender === 'M') return '舅公';
        return '姨婆';
      }
    }

    if (pathStr === 'up-up-sibling-spouse' || pathStr === 'up-up-up-down-spouse') {
      const grandparent = this.getPerson(nodePath[2]);
      const auntUncle = this.getPerson(nodePath[3]);
      const parent = this.getPerson(nodePath[1]);
      const isMaternal = parent?.gender === 'F';
      if (grandparent && auntUncle) {
        if (grandparent.gender === 'M') {
          if (auntUncle.gender === 'M') {
            const rank = this.getGrandparentSiblingRank(grandparent, auntUncle);
            const base = rank?.relation === 'older' ? '伯婆' : '嬸婆';
            return isMaternal ? `外${base}` : base;
          }
          const base = '姑丈公';
          return isMaternal ? `外${base}` : base;
        }
        if (auntUncle.gender === 'M') return '舅媽';
        return '姨丈';
      }
    }

    if (pathStr === 'up-up-sibling-down' || pathStr === 'up-up-up-down-down') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const grandparentSibling = this.getPerson(nodePath[pathStr === 'up-up-sibling-down' ? 3 : 4]);

      if (parent?.gender === 'M' && grandparent?.gender === 'M' && grandparentSibling?.gender === 'M') {
        const rank = this.getGrandparentSiblingRank(grandparent, grandparentSibling);
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
        if (target.gender === 'F') return `${prefix}姑`;
        return `${prefix}親`;
      }
    }

    if (pathStr === 'up-up-sibling-down-spouse' || pathStr === 'up-up-up-down-down-spouse') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const grandparentSibling = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-spouse' ? 3 : 4]);
      const cousin = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-spouse' ? 4 : 5]);

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
        if (cousin.gender === 'F') return `${prefix}姑丈`;
        return `${prefix}姻親`;
      }
    }

    if (pathStr === 'up-up-sibling-down-down' || pathStr === 'up-up-up-down-down-down') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const grandparentSibling = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-down' ? 3 : 4]);
      if (parent && grandparent && grandparentSibling) {
        const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
        const prefix = isSameSurnameLine ? '再堂' : '再表';
        const centerDob = this.centerPerson.dob ? new Date(this.centerPerson.dob).getTime() : 0;
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

    if (pathStr === 'up-up-sibling-down-down-spouse' || pathStr === 'up-up-up-down-down-down-spouse') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const grandparentSibling = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-down-spouse' ? 3 : 4]);
      const cousinChild = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-down-spouse' ? 5 : 6]);
      if (parent && grandparent && grandparentSibling && cousinChild) {
        const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
        const prefix = isSameSurnameLine ? '再堂' : '再表';
        return `${prefix}姻親`;
      }
    }

    if (pathStr === 'up-up-sibling-down-down-down' || pathStr === 'up-up-up-down-down-down-down') {
      const parent = this.getPerson(nodePath[1]);
      const grandparent = this.getPerson(nodePath[2]);
      const grandparentSibling = this.getPerson(nodePath[pathStr === 'up-up-sibling-down-down-down' ? 3 : 4]);
      if (parent && grandparent && grandparentSibling) {
        const isSameSurnameLine = parent.gender === 'M' && grandparent.gender === 'M' && grandparentSibling.gender === 'M';
        const prefix = isSameSurnameLine ? '再堂' : '再表';
        if (target.gender === 'M') return `${prefix}甥`;
        if (target.gender === 'F') return `${prefix}甥女`;
        return `${prefix}甥/甥女`;
      }
    }

    return null;
  }

  private resolveInLawBridgeLine(state: ResolveState) {
    const { pathStr, path, nodePath, target } = state;

    if (pathStr === 'up-inlaw-sibling' || pathStr === 'up-spouse-up-down' || pathStr === 'up-spouse-sibling') {
      const parent = this.getPerson(nodePath[1]);
      if (parent) {
        if (parent.gender === 'M') return target.gender === 'M' ? '舅公' : '姨婆';
        if (parent.gender === 'F') return target.gender === 'M' ? '伯公/叔公' : '姑婆';
      }
    }

    if (pathStr === 'up-inlaw-sibling-down' || pathStr === 'up-spouse-up-down-down' || pathStr === 'up-spouse-sibling-down') {
      if (target.gender === 'M') return '從伯叔';
      if (target.gender === 'F') return '從姑';
      return '從伯叔/從姑';
    }

    if (
      pathStr === 'up-inlaw-sibling-spouse'
      || pathStr === 'up-spouse-up-down-spouse'
      || pathStr === 'up-spouse-sibling-spouse'
    ) {
      const parent = this.getPerson(nodePath[1]);
      const inLawSibling = this.getPerson(nodePath[nodePath.length - 2]);
      return this.getParentInLawSiblingSpouseTitle(parent, inLawSibling, target);
    }

    if (
      pathStr === 'up-inlaw-sibling-down-spouse'
      || pathStr === 'up-spouse-up-down-down-spouse'
      || pathStr === 'up-spouse-sibling-down-spouse'
    ) {
      const parent = this.getPerson(nodePath[1]);
      const cousin = this.getPerson(nodePath[nodePath.length - 2]);
      return this.getCousinInLawTitle(parent, cousin);
    }

    if (
      pathStr === 'up-inlaw-sibling-down-spouse-down'
      || pathStr === 'up-spouse-up-down-down-spouse-down'
      || pathStr === 'up-spouse-sibling-down-spouse-down'
    ) {
      if (target.gender === 'M') return '姻親表親之子';
      if (target.gender === 'F') return '姻親表親之女';
      return '姻親表親之子/女';
    }

    if (
      pathStr === 'up-inlaw-sibling-down-spouse-down-down'
      || pathStr === 'up-spouse-up-down-down-spouse-down-down'
      || pathStr === 'up-spouse-sibling-down-spouse-down-down'
    ) {
      if (target.gender === 'M') return '姻親表親孫輩(男)';
      if (target.gender === 'F') return '姻親表親孫輩(女)';
      return '姻親表親孫輩';
    }

    if (pathStr === 'inlaw-sibling-down') return '姻親的子女';

    if (pathStr === 'up-inlaw') {
      if (target.gender === 'M') return '姊夫/妹夫';
      return '嫂嫂/弟媳';
    }
    if (pathStr === 'up-inlaw-down') return target.gender === 'M' ? '姪子' : '姪女';
    if (pathStr === 'up-inlaw-down-down') return target.gender === 'M' ? '姪孫' : '姪孫女';

    if (pathStr === 'up-inlaw-inlaw') {
      const parent = this.getPerson(nodePath[1]);
      if (parent) {
        if (parent.gender === 'M') {
          if (target.gender === 'M') {
            const rank = this.getParentSiblingRank(parent, target);
            if (rank?.relation === 'older') {
              return this.getNumberedTitle(rank.rank, ['大伯', '二伯', '三伯', '四伯', '五伯', '六伯', '七伯', '八伯', '九伯', '十伯'], '伯');
            }
            return '叔叔';
          }
          return '姑姑';
        }
        if (target.gender === 'M') return '舅舅';
        return '阿姨';
      }
    }

    if (pathStr === 'up-inlaw-inlaw') {
      const parent = this.getPerson(nodePath[1]);
      const possibleSibling = this.getPerson(nodePath[2]);
      const possibleSpouse = this.getPerson(nodePath[3]);
      if (parent && possibleSibling && possibleSpouse) {
        const parentIds = this.relationships
          .filter((relationship) => relationship.type === 'parent_child' && relationship.to_person_id === parent.id)
          .map((relationship) => relationship.from_person_id);
        const siblingParentIds = this.relationships
          .filter((relationship) => relationship.type === 'parent_child' && relationship.to_person_id === possibleSibling.id)
          .map((relationship) => relationship.from_person_id);
        const sharesParent = parentIds.some((id) => siblingParentIds.includes(id));
        const isSpouse = this.relationships.some((relationship) => (
          relationship.type === 'spouse'
          && ((relationship.from_person_id === possibleSibling.id && relationship.to_person_id === possibleSpouse.id)
            || (relationship.to_person_id === possibleSibling.id && relationship.from_person_id === possibleSpouse.id))
        ));

        if (sharesParent && isSpouse) {
          const title = this.getParentSiblingSpouseTitle(parent, possibleSibling);
          if (title) return title;
        }
      }
    }

    if (path[path.length - 1] === 'up') {
      const inlawSteps = path.filter((segment) => segment === 'spouse' || segment === 'inlaw' || segment === 'ex_spouse').length;
      if (inlawSteps >= 2) {
        return this.getInLawElderTitle(target);
      }
    }

    return null;
  }

  private resolveSiblingDescendantLine(state: ResolveState) {
    const { path, pathStr, nodePath, target } = state;

    if (
      pathStr.startsWith('sibling-down')
      || pathStr.startsWith('sibling-sibling-down')
      || pathStr.startsWith('up-down-down')
    ) {
      let sibling: Person | undefined;
      let downCount = 0;
      if (pathStr.startsWith('sibling-sibling-down')) {
        sibling = this.getPerson(nodePath[2]);
        downCount = path.slice(2).filter((segment) => segment === 'down').length;
      } else if (path[0] === 'sibling') {
        sibling = this.getPerson(nodePath[1]);
        downCount = path.slice(1).filter((segment) => segment === 'down').length;
      } else if (path[0] === 'up' && path[1] === 'down') {
        sibling = this.getPerson(nodePath[2]);
        downCount = path.slice(2).filter((segment) => segment === 'down').length;
      }

      if (sibling && downCount >= 1) {
        const siblingGender = sibling.gender;
        const targetIsMale = target.gender === 'M';
        const targetIsFemale = target.gender === 'F';

        if (downCount === 1) {
          if (siblingGender === 'M') return targetIsMale ? '姪子' : '姪女';
          if (siblingGender === 'F') return targetIsMale ? '外甥' : '外甥女';
          return targetIsFemale ? '姪/甥女' : '姪/甥';
        }

        if (downCount === 2) {
          if (siblingGender === 'M') return targetIsMale ? '姪孫' : '姪孫女';
          if (siblingGender === 'F') return targetIsMale ? '外甥孫' : '外甥孫女';
          return targetIsFemale ? '姪/甥孫女' : '姪/甥孫';
        }

        const prefixMap = ['', '', '', '曾', '玄', '來', '第六代', '第七代', '第八代'];
        const prefix = prefixMap[downCount] || `第${downCount}代`;
        const base = siblingGender === 'F' ? '外甥孫' : '姪孫';
        const suffix = targetIsMale ? '' : '女';
        return `${prefix}${base}${suffix}`;
      }
    }

    return null;
  }

  private resolveDescendantLine(state: ResolveState) {
    const { pathStr, nodePath, target } = state;

    if (pathStr === 'down-down') {
      const child = this.getPerson(nodePath[1]);
      if (child) {
        if (child.gender === 'M') return target.gender === 'M' ? '孫子' : '孫女';
        return target.gender === 'M' ? '外孫' : '外孫女';
      }
      if (target.gender === 'M') return '孫子/外孫';
      return '孫女/外孫女';
    }

    if (pathStr === 'down-down-down') return target.gender === 'M' ? '曾孫' : '曾孫女';
    if (pathStr === 'down-down-down-down') return target.gender === 'M' ? '玄孫' : '玄孫女';
    if (pathStr === 'down-down-down-down-down') return target.gender === 'M' ? '來孫' : '來孫女';
    if (pathStr === 'down-spouse') return target.gender === 'M' ? '女婿' : '媳婦';
    if (pathStr === 'down-spouse-up' || pathStr === 'down-inlaw-up') return target.gender === 'M' ? '親家公' : '親家婆';
    if (pathStr === 'down-spouse-up-spouse' || pathStr === 'down-inlaw-up-spouse') {
      if (target.gender === 'M') return '親家公';
      if (target.gender === 'F') return '親家婆';
      return '親家公/親家婆';
    }
    if (pathStr === 'down-spouse-sibling' || pathStr === 'down-inlaw-sibling') {
      if (target.gender === 'M') return '姻親兄弟';
      if (target.gender === 'F') return '姻親姊妹';
      return '姻親兄弟/姻親姊妹';
    }
    if (pathStr === 'down-spouse-sibling-spouse' || pathStr === 'down-inlaw-sibling-spouse') return '姻親';
    if (pathStr === 'down-spouse-sibling-down' || pathStr === 'down-inlaw-sibling-down') return '姻親的子女';
    if (pathStr === 'down-inlaw') return target.gender === 'M' ? '女婿' : '媳婦';
    return null;
  }

  private resolveSiblingInLawLine(state: ResolveState) {
    const { pathStr, nodePath, target } = state;

    if (pathStr === 'up-down-spouse' || pathStr === 'sibling-spouse' || pathStr === 'sibling-sibling-inlaw') {
      const sibling = pathStr === 'sibling-spouse' ? this.getPerson(nodePath[1]) : this.getPerson(nodePath[2]);

      if (sibling?.gender === 'M') {
        const rank = this.getSiblingRank(sibling);
        if (rank?.relation === 'older') {
          return this.getNumberedTitle(rank.rank, ['大嫂', '二嫂', '三嫂', '四嫂', '五嫂', '六嫂', '七嫂', '八嫂', '九嫂', '十嫂'], '嫂');
        }
        return '弟媳';
      }
      if (sibling?.gender === 'F') {
        const rank = this.getSiblingRank(sibling);
        if (rank?.relation === 'older') {
          return this.getNumberedTitle(rank.rank, ['大姐夫', '二姐夫', '三姐夫', '四姐夫', '五姐夫', '六姐夫', '七姐夫', '八姐夫', '九姐夫', '十姐夫'], '姐夫');
        }
        return '妹夫';
      }
      if (target.gender === 'M') return '姊夫/妹夫';
      return '嫂嫂/弟媳';
    }

    if (pathStr === 'up-down-spouse-sibling' || pathStr === 'sibling-spouse-sibling') {
      const linkingSibling = pathStr === 'sibling-spouse-sibling' ? this.getPerson(nodePath[1]) : this.getPerson(nodePath[2]);
      if (linkingSibling) {
        const centerDob = this.centerPerson.dob ? new Date(this.centerPerson.dob).getTime() : 0;
        const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
        if (target.gender === 'M') {
          if (centerDob && targetDob) return targetDob < centerDob ? '親家大哥' : '親家弟弟';
          return '親家兄弟';
        }
        if (centerDob && targetDob) return targetDob < centerDob ? '親家大姊' : '親家妹妹';
        return '親家姊妹';
      }
    }

    if (pathStr === 'up-down-spouse-sibling-spouse' || pathStr === 'sibling-spouse-sibling-spouse') return '姻親';
    if (pathStr === 'up-down-spouse-sibling-down' || pathStr === 'sibling-spouse-sibling-down') return '姻親的子女';

    if (
      pathStr === 'up-down-spouse-sibling-down-sibling'
      || pathStr === 'sibling-spouse-sibling-down-sibling'
    ) {
      const inLawChild = this.getPerson(nodePath[nodePath.length - 2]);
      const inLawChildDob = inLawChild?.dob ? new Date(inLawChild.dob).getTime() : 0;
      const targetDob = target.dob ? new Date(target.dob).getTime() : 0;
      const isOlder = inLawChildDob && targetDob ? targetDob < inLawChildDob : null;

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

    if (pathStr === 'sibling-spouse-up' || pathStr === 'up-down-spouse-up') return this.getUncleAuntieTitle(target);
    if (pathStr === 'sibling-spouse-up-spouse' || pathStr === 'up-down-spouse-up-spouse') return '姻親父母';
    if (pathStr === 'sibling-spouse-up-sibling-spouse' || pathStr === 'up-down-spouse-up-sibling-spouse') return this.getUncleAuntieTitle(target);
    if (pathStr === 'sibling-spouse-up-sibling-down' || pathStr === 'up-down-spouse-up-sibling-down') {
      if (target.gender === 'M') return this.formatDualTitle('表兄弟', '姻親表兄弟');
      if (target.gender === 'F') return this.formatDualTitle('表姊妹', '姻親表姊妹');
      return this.formatDualTitle('表兄弟/表姊妹', '姻親表親');
    }

    return null;
  }

  private resolveSpouseLine(state: ResolveState) {
    const { pathStr, nodePath, target } = state;

    if (pathStr === 'spouse-up-down' || pathStr === 'spouse-sibling') {
      if (target.gender === 'M') return '大伯/小叔/內兄/內弟';
      return '姑嫂';
    }
    if (pathStr === 'spouse-up-sibling-down' || pathStr === 'spouse-up-up-down-down') return '姻親表親';
    if (pathStr === 'spouse-sibling-down' || pathStr === 'spouse-up-down-down') {
      if (target.gender === 'M') return '姪子/外甥(姻)';
      return '姪女/外甥女(姻)';
    }
    if (pathStr === 'spouse-sibling-down-down' || pathStr === 'spouse-up-down-down-down') {
      if (target.gender === 'M') return '姻親孫';
      if (target.gender === 'F') return '姻親孫女';
      return '姻親孫/孫女';
    }
    if (pathStr === 'spouse-sibling-down-spouse' || pathStr === 'spouse-up-down-down-spouse') {
      if (target.gender === 'M') return '姪女婿/外甥女婿';
      if (target.gender === 'F') return '姪媳/外甥媳';
      return '姪媳/姪女婿';
    }
    if (pathStr === 'spouse-down') return target.gender === 'M' ? '繼子' : '繼女';

    if (pathStr === 'spouse-up') {
      if (target.gender === 'M') return '岳父/公公';
      return '岳母/婆婆';
    }

    if (pathStr === 'spouse-up-sibling' || pathStr === 'spouse-up-up-down') {
      const inLawParent = this.getPerson(nodePath[2]);
      if (this.centerPerson.gender === 'M') {
        if (target.gender === 'M' && inLawParent) {
          const rank = this.getParentSiblingRank(inLawParent, target);
          if (rank?.relation === 'older') return '岳伯';
          return '岳叔';
        }
        if (target.gender === 'F') return '岳姑';
        return '岳伯/岳叔';
      }
      if (this.centerPerson.gender === 'F') {
        if (target.gender === 'M' && inLawParent) {
          const rank = this.getParentSiblingRank(inLawParent, target);
          if (rank?.relation === 'older') return '公伯';
          if (rank) return '公叔';
          return '公伯/公叔';
        }
        if (target.gender === 'F') return '婆姑';
        return '公伯/公叔';
      }
      return target.gender === 'M' ? '姻親伯叔' : '姻親姑';
    }

    if (pathStr === 'spouse-up-sibling-spouse' || pathStr === 'spouse-up-up-down-spouse') {
      const inLawParent = this.getPerson(nodePath[2]);
      const inLawSibling = this.getPerson(nodePath[3]);
      const inLawSiblingRank = inLawParent && inLawSibling
        ? this.getParentSiblingRank(inLawParent, inLawSibling)
        : null;
      const isOlder = inLawSiblingRank?.relation === 'older';
      if (this.centerPerson.gender === 'M') {
        if (target.gender === 'M') return '岳姑丈';
        if (target.gender === 'F') return isOlder === undefined ? '岳伯母/岳嬸' : (isOlder ? '岳伯母' : '岳嬸');
        return '岳伯母/岳嬸';
      }
      if (this.centerPerson.gender === 'F') {
        if (target.gender === 'M') return '婆姑丈';
        if (target.gender === 'F') return isOlder === undefined ? '公伯母/公嬸' : (isOlder ? '公伯母' : '公嬸');
        return '公伯母/公嬸';
      }
      return '姻親';
    }

    if (pathStr === 'spouse-up-sibling-down-spouse' || pathStr === 'spouse-up-up-down-down-spouse') {
      const inLaw = this.getPerson(nodePath[1]);
      const cousin = this.getPerson(nodePath[pathStr === 'spouse-up-sibling-down-spouse' ? 4 : 5]);
      return this.getCousinInLawTitle(inLaw, cousin);
    }

    if (pathStr === 'sibling-spouse-up-sibling-down-spouse' || pathStr === 'up-down-spouse-up-sibling-down-spouse') {
      const inLaw = this.getPerson(nodePath[pathStr === 'sibling-spouse-up-sibling-down-spouse' ? 2 : 3]);
      const cousin = this.getPerson(nodePath[pathStr === 'sibling-spouse-up-sibling-down-spouse' ? 5 : 6]);
      return this.getCousinInLawTitle(inLaw, cousin);
    }

    if (pathStr === 'spouse-up-sibling-down-down' || pathStr === 'spouse-up-up-down-down-down') return '姻親表親';
    if (pathStr === 'spouse-up-sibling-down-down-spouse' || pathStr === 'spouse-up-up-down-down-down-spouse') return '姻親表親的配偶';
    if (pathStr === 'spouse-up-sibling-down-down-down' || pathStr === 'spouse-up-up-down-down-down-down') return '姻親表親的子女';

    if (pathStr === 'spouse-up-up') {
      if (this.centerPerson.gender === 'M') return target.gender === 'M' ? '岳祖父' : '岳祖母';
      if (this.centerPerson.gender === 'F') return target.gender === 'M' ? '夫祖父' : '夫祖母';
      return target.gender === 'M' ? '配偶祖父' : '配偶祖母';
    }
    if (pathStr === 'spouse-up-up-spouse') {
      if (this.centerPerson.gender === 'M') return target.gender === 'M' ? '岳祖父' : '岳祖母';
      if (this.centerPerson.gender === 'F') return target.gender === 'M' ? '夫祖父' : '夫祖母';
      return target.gender === 'M' ? '配偶祖父' : '配偶祖母';
    }

    if (pathStr === 'spouse-sibling-spouse' || pathStr === 'spouse-up-down-spouse') return '姻親';

    return null;
  }

  private resolveCousinLine(state: ResolveState) {
    const { pathStr, nodePath, target } = state;

    if (pathStr === 'up-up-down-down' || pathStr === 'up-sibling-down') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(pathStr === 'up-sibling-down' ? nodePath[2] : nodePath[2]);
      const centerDob = this.centerPerson.dob ? new Date(this.centerPerson.dob).getTime() : 0;
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

    if (pathStr === 'up-up-down-down-down' || pathStr === 'up-sibling-down-down') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[pathStr === 'up-sibling-down-down' ? 2 : 3]);
      const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
      if (isPaternalBrother) {
        if (target.gender === 'M') return '堂甥';
        if (target.gender === 'F') return '堂甥女';
        return '堂甥/堂甥女';
      }
      if (target.gender === 'M') return '表甥';
      if (target.gender === 'F') return '表甥女';
      return '表甥/表甥女';
    }

    if (pathStr === 'up-up-down-down-down-down' || pathStr === 'up-sibling-down-down-down') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[pathStr === 'up-sibling-down-down-down' ? 2 : 3]);
      const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
      if (isPaternalBrother) {
        if (target.gender === 'M') return '堂曾甥';
        if (target.gender === 'F') return '堂曾甥女';
        return '堂曾甥/堂曾甥女';
      }
      if (target.gender === 'M') return '表曾甥';
      if (target.gender === 'F') return '表曾甥女';
      return '表曾甥/表曾甥女';
    }

    if (pathStr === 'up-up-down-down-down-spouse' || pathStr === 'up-sibling-down-down-spouse') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[pathStr === 'up-sibling-down-down-spouse' ? 2 : 3]);
      const cousinChild = this.getPerson(nodePath[pathStr === 'up-sibling-down-down-spouse' ? 4 : 5]);
      const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
      if (cousinChild?.gender === 'M') return isPaternalBrother ? '堂甥媳' : '表甥媳';
      if (cousinChild?.gender === 'F') return isPaternalBrother ? '堂甥女婿' : '表甥女婿';
      return isPaternalBrother ? '堂甥媳/堂甥女婿' : '表甥媳/表甥女婿';
    }

    if (pathStr === 'up-up-down-down-down-spouse-up' || pathStr === 'up-sibling-down-down-spouse-up') {
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[pathStr === 'up-sibling-down-down-spouse-up' ? 2 : 3]);
      const cousinChild = this.getPerson(nodePath[pathStr === 'up-sibling-down-down-spouse-up' ? 4 : 5]);
      const isPaternalBrother = parent?.gender === 'M' && auntUncle?.gender === 'M';
      if (cousinChild?.gender === 'M') return isPaternalBrother ? '堂甥媳的父母' : '表甥媳的父母';
      if (cousinChild?.gender === 'F') return isPaternalBrother ? '堂甥女婿的父母' : '表甥女婿的父母';
      return isPaternalBrother ? '堂甥媳/堂甥女婿的父母' : '表甥媳/表甥女婿的父母';
    }

    if (pathStr === 'up-up-down-down-spouse' || pathStr === 'up-sibling-down-spouse') {
      const cousinIndex = pathStr === 'up-sibling-down-spouse' ? 3 : 4;
      const auntUncleIndex = pathStr === 'up-sibling-down-spouse' ? 2 : 3;
      const parent = this.getPerson(nodePath[1]);
      const auntUncle = this.getPerson(nodePath[auntUncleIndex]);
      const cousin = this.getPerson(nodePath[cousinIndex]);
      const centerDob = this.centerPerson.dob ? new Date(this.centerPerson.dob).getTime() : 0;
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

    return null;
  }

  private resolveExtendedInLawLine(state: ResolveState) {
    const { pathStr, target } = state;
    if (pathStr.startsWith('up-spouse') || pathStr.startsWith('up-down-spouse')) {
      return null;
    }
    return null;
  }

  private resolveFallback(path: string[]) {
    return this.formatDebugPath(path);
  }
}
