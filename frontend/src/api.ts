import { adminApi } from './api/admin';
import { authApi, type LoginResponse } from './api/auth';
import { graphApi } from './api/graph';
import { labelsApi } from './api/labels';
import { notificationsApi } from './api/notifications';
import { peopleApi, type CreatePersonInput, type CreateRelationshipResponse, type PersonUpdates } from './api/people';

export type { CreatePersonInput, CreateRelationshipResponse, LoginResponse, PersonUpdates };

type LegacyCreatePersonArgs = [
  name: string,
  english_name: string | undefined,
  gender: 'M' | 'F' | 'O',
  dob?: string,
  dod?: string,
  tob?: string,
  tod?: string,
  blood_type?: string,
  metadata?: unknown,
  id?: string,
  avatar_url?: string,
  layer_id?: string,
];

export const api = {
  ...graphApi,
  ...authApi,
  ...notificationsApi,
  ...labelsApi,
  ...adminApi,
  ...peopleApi,
  createPerson: async (...args: [CreatePersonInput] | LegacyCreatePersonArgs) => {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && 'name' in args[0]) {
      return peopleApi.createPerson(args[0] as CreatePersonInput);
    }
    const [
      name,
      english_name,
      gender,
      dob,
      dod,
      tob,
      tod,
      blood_type,
      metadata,
      id,
      avatar_url,
      layer_id,
    ] = args as LegacyCreatePersonArgs;
    return peopleApi.createPerson({
      name,
      english_name,
      gender,
      dob,
      dod,
      tob,
      tod,
      blood_type,
      metadata,
      id,
      avatar_url,
      layer_id,
    });
  },
};
