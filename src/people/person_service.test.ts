import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonPayload, buildPersonUpdatePayload, extractCustomFields, normalizeEmail } from './person_service';

test('buildPersonUpdatePayload only includes changed keys and stamps updated_at when needed', () => {
  const result = buildPersonUpdatePayload({
    name: 'Alice',
    includeEmail: true,
    normalizedEmail: 'alice@example.com',
    protectedUpdates: { dob: 'enc-dob', blood_type: undefined },
    metadataProtected: undefined,
    now: '2026-04-05T00:00:00.000Z',
  });

  assert.deepEqual(result.changedFields, ['name', 'email', 'dob']);
  assert.deepEqual(result.updatePayload, {
    name: 'Alice',
    email: 'alice@example.com',
    dob: 'enc-dob',
    updated_at: '2026-04-05T00:00:00.000Z',
  });
});

test('buildPersonPayload merges parsed metadata with custom fields and primary avatar', () => {
  const payload = buildPersonPayload(
    {
      id: 'p1',
      name: 'Alice',
      layer_id: 'default',
      avatar_url: '/api/avatars/legacy',
      metadata: '{"note":"hi"}',
    },
    [{ label: 'Nickname', value: 'Al' }],
    [
      { id: 'a1', person_id: 'p1', avatar_url: '/api/avatars/a1', storage_key: 'a1', is_primary: true, sort_order: 0, created_at: null, updated_at: null },
    ],
    (avatars) => avatars.find((avatar) => avatar.is_primary) || null,
    '2026-04-05T00:00:00.000Z',
  );

  assert.equal(payload.avatar_url, '/api/avatars/a1');
  assert.equal(payload.email_verified_at, '2026-04-05T00:00:00.000Z');
  assert.deepEqual(payload.metadata, {
    note: 'hi',
    customFields: [{ label: 'Nickname', value: 'Al' }],
  });
});

test('extractCustomFields prefers explicit custom_fields and normalizeEmail trims safely', () => {
  const fields = extractCustomFields(
    {
      custom_fields: [{ label: 'Nickname', value: 'Al' }],
    },
    {
      customFields: [{ label: 'Ignored', value: 'Nope' }],
    },
  );

  assert.deepEqual(fields, [{ label: 'Nickname', value: 'Al' }]);
  assert.equal(normalizeEmail(' Alice@Example.COM '), 'alice@example.com');
  assert.equal(normalizeEmail('   '), null);
});
