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

  constructor(
    private readonly people: Person[],
    private readonly relationships: Relationship[],
  ) {
    people.forEach((p) => this.peopleMap.set(p.id, p));

    relationships.forEach((relationship) => {
      if (relationship.type === 'sibling') {
        if (!this.siblingMap.has(relationship.from_person_id)) this.siblingMap.set(relationship.from_person_id, new Set());
        if (!this.siblingMap.has(relationship.to_person_id)) this.siblingMap.set(relationship.to_person_id, new Set());
        this.siblingMap.get(relationship.from_person_id)!.add(relationship.to_person_id);
        this.siblingMap.get(relationship.to_person_id)!.add(relationship.from_person_id);
      } else if (relationship.type === 'parent_child') {
        if (!this.parentsMap.has(relationship.to_person_id)) this.parentsMap.set(relationship.to_person_id, new Set());
        this.parentsMap.get(relationship.to_person_id)!.add(relationship.from_person_id);

        if (!this.childrenMap.has(relationship.from_person_id)) this.childrenMap.set(relationship.from_person_id, new Set());
        this.childrenMap.get(relationship.from_person_id)!.add(relationship.to_person_id);
      }
    });
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
      if (person && person.gender === sibling.gender && person.dob) {
        sameGenderSiblings.push(person);
      }
    });

    sameGenderSiblings.sort((left, right) => new Date(left.dob!).getTime() - new Date(right.dob!).getTime());

    const index = sameGenderSiblings.findIndex((person) => person.id === sibling.id);
    if (index === -1) return null;
    return { relation: 'older', rank: index + 1 };
  }
}
