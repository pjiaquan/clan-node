import { createExactNameMatcher, createNameMatcher } from './nameSearch';

type CustomField = {
  label?: string | null;
  value?: string | null;
};

export type SearchablePerson = {
  id: string;
  name: string;
  english_name?: string | null;
  metadata?: {
    customFields?: CustomField[] | null;
    [key: string]: unknown;
  } | null;
};

const getCustomFieldCandidates = (person: SearchablePerson): string[] => {
  const customFields = person.metadata?.customFields;
  if (!Array.isArray(customFields)) return [];
  return customFields.flatMap((field) => {
    const values: string[] = [];
    if (typeof field?.label === 'string' && field.label.trim()) values.push(field.label);
    if (typeof field?.value === 'string' && field.value.trim()) values.push(field.value);
    return values;
  });
};

export const createPersonSearchMatcher = (query: string) => {
  const trimmed = query.trim();
  if (!trimmed) return (_person: SearchablePerson) => false;

  const exactMatch = createExactNameMatcher(trimmed);
  const fuzzyMatch = createNameMatcher(trimmed);

  return (person: SearchablePerson) => {
    if (
      person.id === trimmed
      || exactMatch(person.name)
      || exactMatch(person.english_name)
      || fuzzyMatch(person.name)
      || fuzzyMatch(person.english_name)
    ) {
      return true;
    }

    const customFieldCandidates = getCustomFieldCandidates(person);
    return customFieldCandidates.some((candidate) => exactMatch(candidate) || fuzzyMatch(candidate));
  };
};

