import type { Person, Relationship } from '../types';

export type RelativeRank = {
  relation: 'older' | 'younger';
  rank: number;
};

export class SiblingRankComputer {
  private readonly siblingMap = new Map<string, Set<string>>();
  private readonly parentsMap = new Map<string, Set<string>>();
  private readonly childrenMap = new Map<string, Set<string>>();
  private readonly peopleMap = new Map<string, Person>();

  private sortedSiblingsCache = new Map<string, Person[]>();

  constructor(
    private readonly people: Person[],
    private readonly relationships: Relationship[],
  ) {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      this.peopleMap.set(p.id, p);
    }

    // Bolt Optimization: Replace forEach with index-based loop and consolidate map lookups
    for (let i = 0; i < relationships.length; i++) {
      const relationship = relationships[i];
      if (relationship.type === 'sibling') {
        let fromSet = this.siblingMap.get(relationship.from_person_id);
        if (fromSet === undefined) {
          fromSet = new Set();
          this.siblingMap.set(relationship.from_person_id, fromSet);
        }
        fromSet.add(relationship.to_person_id);

        let toSet = this.siblingMap.get(relationship.to_person_id);
        if (toSet === undefined) {
          toSet = new Set();
          this.siblingMap.set(relationship.to_person_id, toSet);
        }
        toSet.add(relationship.from_person_id);
      } else if (relationship.type === 'parent_child') {
        let parents = this.parentsMap.get(relationship.to_person_id);
        if (parents === undefined) {
          parents = new Set();
          this.parentsMap.set(relationship.to_person_id, parents);
        }
        parents.add(relationship.from_person_id);

        let children = this.childrenMap.get(relationship.from_person_id);
        if (children === undefined) {
          children = new Set();
          this.childrenMap.set(relationship.from_person_id, children);
        }
        children.add(relationship.to_person_id);
      }
    }
  }

  getSiblingRank(reference: Person, sibling: Person): RelativeRank | null {
    return this.getRelativeSiblingRank(reference, sibling);
  }

  private getRelativeSiblingRank(reference: Person, sibling: Person): RelativeRank | null {
    const referenceDob = reference.dob ? new Date(reference.dob).getTime() : 0;
    const siblingDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!referenceDob || !siblingDob) return null;
    if (siblingDob >= referenceDob) {
      return { relation: 'younger', rank: 0 };
    }

    const sameGenderSiblings = this.getSortedSameGenderSiblings(reference, sibling.gender);

    const index = sameGenderSiblings.findIndex((person) => person.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  }

  private getSortedSameGenderSiblings(reference: Person, gender: string): Person[] {
    const cacheKey = `${reference.id}:${gender}`;
    if (this.sortedSiblingsCache.has(cacheKey)) {
      return this.sortedSiblingsCache.get(cacheKey)!;
    }

    const siblingIds = new Set<string>(this.siblingMap.get(reference.id) || []);
    const parentIds = this.parentsMap.get(reference.id) || new Set<string>();

    parentIds.forEach((parentId) => {
      const children = this.childrenMap.get(parentId) || new Set<string>();
      children.forEach((childId) => {
        if (childId !== reference.id) {
          siblingIds.add(childId);
        }
      });
    });

    const sameGenderSiblings: Person[] = [];
    siblingIds.forEach((id) => {
      const person = this.peopleMap.get(id);
      if (person && person.gender === gender && person.dob) {
        sameGenderSiblings.push(person);
      }
    });

    // Bolt Optimization: ISO 8601 strings can be sorted lexicographically.
    // Avoids creating Date objects inside the sort comparator.
    sameGenderSiblings.sort((left, right) => left.dob! < right.dob! ? -1 : (left.dob! > right.dob! ? 1 : 0));
    this.sortedSiblingsCache.set(cacheKey, sameGenderSiblings);
    return sameGenderSiblings;
  }
}
