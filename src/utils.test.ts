import test from 'node:test';
import assert from 'node:assert/strict';
import { safeParse, safeParseObject } from './utils';

test('safeParse', async (t) => {
  await t.test('handles null and undefined', () => {
    assert.equal(safeParse(null), null);
    assert.equal(safeParse(undefined), null);
  });

  await t.test('handles empty string', () => {
    assert.equal(safeParse(''), null);
  });

  await t.test('parses valid JSON primitives', () => {
    assert.equal(safeParse('"string"'), 'string');
    assert.equal(safeParse('123'), 123);
    assert.equal(safeParse('true'), true);
    assert.equal(safeParse('false'), false);
    assert.equal(safeParse('null'), null);
  });

  await t.test('parses valid JSON arrays', () => {
    assert.deepEqual(safeParse('[1, 2, 3]'), [1, 2, 3]);
    assert.deepEqual(safeParse('[]'), []);
  });

  await t.test('parses valid JSON objects', () => {
    assert.deepEqual(safeParse('{"a": 1, "b": "two"}'), { a: 1, b: 'two' });
    assert.deepEqual(safeParse('{}'), {});
  });

  await t.test('handles invalid JSON gracefully', () => {
    // console.error will be called, we can suppress it or just let it print
    const originalConsoleError = console.error;
    console.error = () => {}; // suppress error output for test
    try {
      assert.equal(safeParse('{invalid json}'), null);
      assert.equal(safeParse('undefined'), null); // undefined is not valid JSON
      assert.equal(safeParse("{'a': 1}"), null); // single quotes are invalid JSON
    } finally {
      console.error = originalConsoleError;
    }
  });
});

test('safeParseObject', async (t) => {
  await t.test('handles valid JSON objects', () => {
    assert.deepEqual(safeParseObject('{"a": 1}'), { a: 1 });
    assert.deepEqual(safeParseObject('{}'), {});
  });

  await t.test('rejects valid JSON arrays', () => {
    assert.equal(safeParseObject('[1, 2]'), null);
    assert.equal(safeParseObject('[]'), null);
  });

  await t.test('rejects valid JSON primitives', () => {
    assert.equal(safeParseObject('"string"'), null);
    assert.equal(safeParseObject('123'), null);
    assert.equal(safeParseObject('true'), null);
    assert.equal(safeParseObject('null'), null);
  });

  await t.test('handles invalid JSON gracefully', () => {
    const originalConsoleError = console.error;
    console.error = () => {}; // suppress error output for test
    try {
      assert.equal(safeParseObject('{invalid}'), null);
    } finally {
      console.error = originalConsoleError;
    }
  });

  await t.test('handles null and undefined', () => {
    assert.equal(safeParseObject(null), null);
    assert.equal(safeParseObject(undefined), null);
    assert.equal(safeParseObject(''), null);
  });
});
