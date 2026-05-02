import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSiblingLinkMeta } from './relationship_utils';

test('buildSiblingLinkMeta uses horizontal handles for age-ordered siblings', () => {
  const link = buildSiblingLinkMeta(
    'older',
    'younger',
    new Date('1990-01-01').getTime(),
    new Date('1995-01-01').getTime(),
  );

  assert.equal(link.fromId, 'older');
  assert.equal(link.toId, 'younger');
  assert.deepEqual(JSON.parse(link.metadata), {
    sourceHandle: 'left-s',
    targetHandle: 'right-t',
  });
});

test('buildSiblingLinkMeta uses horizontal handles by default', () => {
  const link = buildSiblingLinkMeta('left', 'right', 0, 0);

  assert.deepEqual(JSON.parse(link.metadata), {
    sourceHandle: 'left-s',
    targetHandle: 'right-t',
  });
});
