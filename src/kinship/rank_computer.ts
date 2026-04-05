import type { Person, Relationship } from '../types';

export type RelativeRank = {
  relation: 'older' | 'younger';
  rank: number;
};

export class SiblingRankComputer {
  constructor(
    private readonly people: Person[],
    private readonly relationships: Relationship[],
  ) {}

  getSiblingRank(reference: Person, sibling: Person): RelativeRank | null {
    return this.getRelativeSiblingRank(reference, sibling);
  }

  getParentSiblingRank(parent: Person, sibling: Person): RelativeRank | null {
    return this.getRelativeSiblingRank(parent, sibling);
  }

  getGrandparentSiblingRank(grandparent: Person, sibling: Person): RelativeRank | null {
    return this.getRelativeSiblingRank(grandparent, sibling);
  }

  private getRelativeSiblingRank(reference: Person, sibling: Person): RelativeRank | null {
    const referenceDob = reference.dob ? new Date(reference.dob).getTime() : 0;
    const siblingDob = sibling.dob ? new Date(sibling.dob).getTime() : 0;
    if (!referenceDob || !siblingDob) return null;
    if (siblingDob >= referenceDob) {
      return { relation: 'younger', rank: 0 };
    }

    const siblingIds = new Set<string>();
    this.relationships.forEach((relationship) => {
      if (relationship.type === 'sibling') {
        if (relationship.from_person_id === reference.id) siblingIds.add(relationship.to_person_id);
        if (relationship.to_person_id === reference.id) siblingIds.add(relationship.from_person_id);
      }
    });

    const parentIds = this.relationships
      .filter((relationship) => relationship.type === 'parent_child' && relationship.to_person_id === reference.id)
      .map((relationship) => relationship.from_person_id);

    this.relationships
      .filter((relationship) => (
        relationship.type === 'parent_child'
        && parentIds.includes(relationship.from_person_id)
        && relationship.to_person_id !== reference.id
      ))
      .forEach((relationship) => siblingIds.add(relationship.to_person_id));

    const sameGenderSiblings = this.people
      .filter((person) => siblingIds.has(person.id) && person.gender === sibling.gender && person.dob)
      .sort((left, right) => new Date(left.dob!).getTime() - new Date(right.dob!).getTime());

    const index = sameGenderSiblings.findIndex((person) => person.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  }
}
