import type { RelationshipType } from './types';
import type {
  BackupAvatar,
  BackupCustomField,
  BackupKinshipLabel,
  BackupLayer,
  BackupPerson,
  BackupRelationship,
  BackupRelationshipTypeLabel,
} from './backup/service';

export type RepositoryMutationResult = {
  lastRowId: number | null;
  changes: number;
};

export type GraphAvatarRow = {
  id: string;
  person_id: string;
  avatar_url: string;
  storage_key: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: unknown;
  updated_at: unknown;
};

export interface GraphRepository {
  getCenterPerson(layerId: string, centerId: string, includeEmail: boolean): Promise<Record<string, unknown> | null>;
  listPeople(layerId: string, includeEmail: boolean): Promise<Array<Record<string, unknown>>>;
  listRelationships(layerId: string): Promise<Array<Record<string, unknown>>>;
  listCustomFieldRows(layerId: string): Promise<Array<Record<string, unknown>>>;
  listAvatarRows(layerId: string): Promise<GraphAvatarRow[]>;
  listVerifiedEmails(emails: Array<string | null | undefined>): Promise<Map<string, string>>;
}

export interface RelationshipRepository {
  listRelationships(layerId: string): Promise<Array<Record<string, unknown>>>;
  getRelationshipById(id: string): Promise<Record<string, unknown> | null>;
  personExists(layerId: string, personId: string): Promise<boolean>;
  findRelationship(
    layerId: string,
    type: RelationshipType,
    fromPersonId: string,
    toPersonId: string,
    bidirectional?: boolean,
  ): Promise<Record<string, unknown> | null>;
  createRelationship(input: {
    layerId: string;
    fromPersonId: string;
    toPersonId: string;
    type: RelationshipType;
    metadata: string | null;
    createdAt: string;
  }): Promise<RepositoryMutationResult>;
  updateRelationshipById(id: string, updates: Record<string, unknown>): Promise<RepositoryMutationResult>;
  deleteRelationshipById(id: string): Promise<RepositoryMutationResult>;
  listPeopleByIds(layerId: string, personIds: string[]): Promise<Array<Record<string, unknown>>>;
  listSiblingEdges(layerId: string, personId: string): Promise<Array<Record<string, unknown>>>;
  listParentEdgesForChild(layerId: string, childId: string): Promise<Array<Record<string, unknown>>>;
  listChildrenForParents(layerId: string, parentIds: string[], excludeChildId?: string): Promise<Array<Record<string, unknown>>>;
  listChildrenForParent(layerId: string, parentId: string, excludeChildId?: string): Promise<Array<Record<string, unknown>>>;
  listSpouseEdges(layerId: string, personId: string): Promise<Array<Record<string, unknown>>>;
}

export interface PeopleRepository {
  listPeople(layerId: string, includeEmail: boolean): Promise<Array<Record<string, unknown>>>;
  getPersonById(id: string, includeEmail: boolean): Promise<Record<string, unknown> | null>;
  getPersonByIdInLayerDetailed(personId: string, layerId: string, includeEmail: boolean): Promise<Record<string, unknown> | null>;
  getPersonSummaryById(id: string): Promise<Record<string, unknown> | null>;
  getPersonSummaryByIdInLayer(personId: string, layerId: string): Promise<Record<string, unknown> | null>;
  insertPerson(fields: Record<string, unknown>): Promise<RepositoryMutationResult>;
  updatePersonById(id: string, updates: Record<string, unknown>): Promise<RepositoryMutationResult>;
  deletePersonById(id: string): Promise<RepositoryMutationResult>;
  findVerifiedEmailAt(normalizedEmail: string): Promise<string | null>;
  listCustomFieldRowsByLayer(layerId: string): Promise<Array<Record<string, unknown>>>;
  listCustomFieldRowsByPersonId(personId: string): Promise<Array<Record<string, unknown>>>;
  deleteCustomFieldsByPersonId(personId: string): Promise<RepositoryMutationResult>;
  insertCustomField(input: {
    personId: string;
    label: string;
    value: string;
    createdAt: string;
    updatedAt: string;
  }): Promise<RepositoryMutationResult>;
  getPersonByIdInLayer(personId: string, layerId: string): Promise<Record<string, unknown> | null>;
  listSiblingEdges(layerId: string, personId: string): Promise<Array<Record<string, unknown>>>;
}

export interface BackupRepository {
  exportAll(includeEmail: boolean): Promise<{
    layers: Array<Record<string, unknown>>;
    people: Array<Record<string, unknown>>;
    avatars: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown>>;
    customFields: Array<Record<string, unknown>>;
    relationshipTypeLabels: Array<Record<string, unknown>>;
    kinshipLabels: Array<Record<string, unknown>>;
  }>;
  runImportBatch(input: {
    includeEmail: boolean;
    layers: BackupLayer[];
    people: Array<{ person: BackupPerson; protectedFields: Record<string, string | null | undefined> }>;
    avatars: BackupAvatar[];
    encryptedCustomFields: Array<BackupCustomField & { encryptedValue: string }>;
    relationships: BackupRelationship[];
    relationshipTypeLabels: BackupRelationshipTypeLabel[];
    kinshipLabels: BackupKinshipLabel[];
    primaryAvatars: Map<string, string | null>;
    hasRelationshipTypeLabels: boolean;
    hasKinshipLabels: boolean;
  }): Promise<void>;
}
