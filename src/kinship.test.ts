import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateKinship, calculateKinshipMany } from './kinship';
import type { Person, Relationship } from './types';

const people: Person[] = [
  { id: 'me', name: 'Me', gender: 'M', dob: '1990-01-01' },
  { id: 'grandfather', name: 'Grandfather', gender: 'M', dob: '1935-01-01' },
  { id: 'grandmother', name: 'Grandmother', gender: 'F', dob: '1937-01-01' },
  { id: 'father', name: 'Father', gender: 'M', dob: '1960-01-01' },
  { id: 'mother', name: 'Mother', gender: 'F', dob: '1962-01-01' },
  { id: 'older-brother', name: 'Older Brother', gender: 'M', dob: '1988-01-01' },
  { id: 'younger-sister', name: 'Younger Sister', gender: 'F', dob: '1994-01-01' },
  { id: 'paternal-uncle', name: 'Paternal Uncle', gender: 'M', dob: '1958-01-01' },
  { id: 'uncle-wife', name: 'Uncle Wife', gender: 'F', dob: '1961-01-01' },
  { id: 'cousin', name: 'Cousin', gender: 'M', dob: '1992-01-01' },
  { id: 'son', name: 'Son', gender: 'M', dob: '2015-01-01' },
  { id: 'daughter-in-law', name: 'Daughter In Law', gender: 'F', dob: '2015-06-01' },
];

const relationships: Relationship[] = [
  { id: 1, from_person_id: 'grandfather', to_person_id: 'father', type: 'parent_child' },
  { id: 2, from_person_id: 'grandmother', to_person_id: 'father', type: 'parent_child' },
  { id: 3, from_person_id: 'grandfather', to_person_id: 'paternal-uncle', type: 'parent_child' },
  { id: 4, from_person_id: 'grandmother', to_person_id: 'paternal-uncle', type: 'parent_child' },
  { id: 5, from_person_id: 'father', to_person_id: 'paternal-uncle', type: 'sibling' },
  { id: 6, from_person_id: 'father', to_person_id: 'me', type: 'parent_child' },
  { id: 7, from_person_id: 'mother', to_person_id: 'me', type: 'parent_child' },
  { id: 8, from_person_id: 'father', to_person_id: 'older-brother', type: 'parent_child' },
  { id: 9, from_person_id: 'mother', to_person_id: 'older-brother', type: 'parent_child' },
  { id: 10, from_person_id: 'father', to_person_id: 'younger-sister', type: 'parent_child' },
  { id: 11, from_person_id: 'mother', to_person_id: 'younger-sister', type: 'parent_child' },
  { id: 12, from_person_id: 'paternal-uncle', to_person_id: 'cousin', type: 'parent_child' },
  { id: 13, from_person_id: 'father', to_person_id: 'mother', type: 'spouse' },
  { id: 14, from_person_id: 'paternal-uncle', to_person_id: 'uncle-wife', type: 'spouse' },
  { id: 15, from_person_id: 'me', to_person_id: 'son', type: 'parent_child' },
  { id: 16, from_person_id: 'son', to_person_id: 'daughter-in-law', type: 'in_law' },
];

const centerPerson = people.find((person) => person.id === 'me')!;

test('calculateKinship supports context object and direct parent lookup', () => {
  const result = calculateKinship({
    centerId: 'me',
    targetId: 'father',
    relationships,
    people,
    centerPerson,
  });
  assert.deepEqual(result, { title: '父親', formalTitle: '父親' });
});

test('calculateKinship keeps sibling ordering titles', () => {
  assert.equal(calculateKinship('me', 'older-brother', relationships, people, centerPerson).title, '大哥');
  assert.equal(calculateKinship('me', 'younger-sister', relationships, people, centerPerson).title, '妹妹');
});

test('calculateKinship resolves parent sibling spouse titles', () => {
  const result = calculateKinship('me', 'uncle-wife', relationships, people, centerPerson);
  assert.deepEqual(result, { title: '大伯母', formalTitle: '大伯母' });
});

test('calculateKinship resolves cousin titles', () => {
  const result = calculateKinship('me', 'cousin', relationships, people, centerPerson);
  assert.deepEqual(result, { title: '堂弟', formalTitle: '堂弟' });
});

test('calculateKinship resolves child in-law via in_law edge', () => {
  const result = calculateKinship('me', 'daughter-in-law', relationships, people, centerPerson);
  assert.deepEqual(result, { title: '媳婦', formalTitle: '媳婦' });
});

test('calculateKinshipMany matches single-target calculation results', () => {
  const targetIds = people.map((person) => person.id);
  const batchResults = calculateKinshipMany({
    centerId: 'me',
    targetIds,
    relationships,
    people,
    centerPerson,
  });

  for (const targetId of targetIds) {
    assert.deepEqual(
      batchResults.get(targetId),
      calculateKinship('me', targetId, relationships, people, centerPerson),
      targetId,
    );
  }
});
