import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_VERSION,
  buildExportPayload,
  buildLegacyDefaultLayer,
  parseAvatars,
  parsePeople,
  validateRelations,
} from './service';

test('parsePeople defaults missing layer and gender safely', () => {
  const people = parsePeople([
    { id: 'p1', name: 'Alice' },
  ], '2026-04-05T00:00:00.000Z');

  assert.equal(people[0].layer_id, 'default');
  assert.equal(people[0].gender, 'O');
});

test('validateRelations rejects cross-layer relationships', () => {
  assert.throws(() => validateRelations(
    [
      { id: 'l1', name: 'Layer 1', description: null, created_at: '2026-04-05T00:00:00.000Z', updated_at: '2026-04-05T00:00:00.000Z' },
      { id: 'l2', name: 'Layer 2', description: null, created_at: '2026-04-05T00:00:00.000Z', updated_at: '2026-04-05T00:00:00.000Z' },
    ],
    [
      { id: 'a', layer_id: 'l1', name: 'Alice', english_name: null, email: null, gender: 'F', blood_type: null, dob: null, dod: null, tob: null, tod: null, avatar_url: null, metadata: null, created_at: '2026-04-05T00:00:00.000Z', updated_at: '2026-04-05T00:00:00.000Z' },
      { id: 'b', layer_id: 'l2', name: 'Bob', english_name: null, email: null, gender: 'M', blood_type: null, dob: null, dod: null, tob: null, tod: null, avatar_url: null, metadata: null, created_at: '2026-04-05T00:00:00.000Z', updated_at: '2026-04-05T00:00:00.000Z' },
    ],
    [],
    [
      { id: 1, layer_id: 'l1', from_person_id: 'a', to_person_id: 'b', type: 'spouse', metadata: null, created_at: '2026-04-05T00:00:00.000Z' },
    ],
    [],
  ), /crosses layers/);
});

test('buildExportPayload preserves key backup collections', () => {
  const payload = buildExportPayload(
    'admin',
    [buildLegacyDefaultLayer('2026-04-05T00:00:00.000Z')],
    [{
      id: 'p1',
      layer_id: 'default',
      name: 'Alice',
      english_name: null,
      email: 'alice@example.com',
      gender: 'F',
      blood_type: null,
      dob: null,
      dod: null,
      tob: null,
      tod: null,
      avatar_url: '/api/avatars/a1',
      metadata: '{"note":"hello"}',
      created_at: '2026-04-05T00:00:00.000Z',
      updated_at: '2026-04-05T00:00:00.000Z',
    }],
    [{
      id: 'a1',
      person_id: 'p1',
      avatar_url: '/api/avatars/a1',
      storage_key: 'a1',
      is_primary: 1,
      sort_order: 0,
      created_at: '2026-04-05T00:00:00.000Z',
      updated_at: '2026-04-05T00:00:00.000Z',
    }],
    [{
      id: 1,
      layer_id: 'default',
      from_person_id: 'p1',
      to_person_id: 'p2',
      type: 'spouse',
      metadata: '{"sourceHandle":"left-s"}',
      created_at: '2026-04-05T00:00:00.000Z',
    }],
    [{
      id: 1,
      person_id: 'p1',
      label: 'Nickname',
      value: 'Al',
      created_at: '2026-04-05T00:00:00.000Z',
      updated_at: '2026-04-05T00:00:00.000Z',
    }],
    [{
      type: 'spouse',
      label: 'Spouse',
      description: '',
      created_at: '2026-04-05T00:00:00.000Z',
      updated_at: '2026-04-05T00:00:00.000Z',
    }],
    [{
      default_title: '父親',
      default_formal_title: '父親',
      custom_title: '爸爸',
      custom_formal_title: '爸爸',
      description: '',
      created_at: '2026-04-05T00:00:00.000Z',
      updated_at: '2026-04-05T00:00:00.000Z',
    }],
  );

  assert.equal(payload.version, BACKUP_VERSION);
  assert.equal(payload.exported_by, 'admin');
  assert.equal(payload.layers.length, 1);
  assert.equal(payload.people[0].email, 'alice@example.com');
  assert.equal(payload.person_avatars[0].is_primary, true);
  assert.equal(payload.relationships[0].type, 'spouse');
  assert.equal(payload.person_custom_fields[0].label, 'Nickname');
  assert.equal(payload.relationship_type_labels[0].label, 'Spouse');
  assert.equal(payload.kinship_labels[0].custom_title, '爸爸');
});

test('parseAvatars rejects storage keys and URLs a backup must not be able to plant', () => {
  const VALID_KEY = 'person-11111111-1111-4111-8111-111111111111-1700000000000-22222222-2222-4222-8222-222222222222.jpg';
  const row = (overrides: Record<string, unknown>) => ([{
    id: 'avatar-1',
    person_id: 'person-1',
    avatar_url: `/api/avatars/${VALID_KEY}`,
    storage_key: VALID_KEY,
    is_primary: true,
    sort_order: 0,
    ...overrides,
  }]);

  // A good row still parses.
  const parsed = parseAvatars(row({}), '2026-01-01T00:00:00.000Z');
  assert.equal(parsed[0].storage_key, VALID_KEY);
  assert.equal(parsed[0].avatar_url, `/api/avatars/${VALID_KEY}`);

  // storage_key reaches the object store on delete; on self-host that is a
  // filesystem path.
  for (const storage_key of ['../clan-node.sqlite', '/etc/passwd', 'sub/dir.png', '..']) {
    assert.throws(
      () => parseAvatars(row({ storage_key }), '2026-01-01T00:00:00.000Z'),
      /Invalid person_avatars\[0\].storage_key/,
      `storage_key ${JSON.stringify(storage_key)} should be refused`
    );
  }

  // avatar_url is rendered by every client.
  for (const avatar_url of [
    'https://attacker.test/p.png',
    '/api/avatars/../clan-node.sqlite',
    'javascript:alert(1)',
    '/api/people/1',
  ]) {
    assert.throws(
      () => parseAvatars(row({ avatar_url }), '2026-01-01T00:00:00.000Z'),
      /Invalid person_avatars\[0\].avatar_url/,
      `avatar_url ${JSON.stringify(avatar_url)} should be refused`
    );
  }

  // An absent storage_key stays absent rather than failing.
  assert.equal(parseAvatars(row({ storage_key: null }), '2026-01-01T00:00:00.000Z')[0].storage_key, null);
});
