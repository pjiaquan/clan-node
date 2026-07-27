import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAvatarUpload } from './avatar_validation';

const createMockFile = (bytes: number[]): Pick<Blob, 'arrayBuffer'> => {
  const buffer = new Uint8Array(bytes).buffer;
  return {
    arrayBuffer: async () => buffer,
  };
};

test('validateAvatarUpload', async (t) => {
  await t.test('accepts valid JPEG', async () => {
    const file = createMockFile([0xff, 0xd8, 0xff, 0x12, 0x34]);
    const result = await validateAvatarUpload(file, 100);
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.extension, 'jpg');
    assert.equal(result.bytes.length, 5);
  });

  await t.test('accepts valid PNG', async () => {
    const file = createMockFile([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x12, 0x34]);
    const result = await validateAvatarUpload(file, 100);
    assert.equal(result.contentType, 'image/png');
    assert.equal(result.extension, 'png');
  });

  await t.test('accepts valid WEBP', async () => {
    const file = createMockFile([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // length (ignored)
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x12, 0x34
    ]);
    const result = await validateAvatarUpload(file, 100);
    assert.equal(result.contentType, 'image/webp');
    assert.equal(result.extension, 'webp');
  });

  await t.test('rejects empty file', async () => {
    const file = createMockFile([]);
    await assert.rejects(
      validateAvatarUpload(file, 100),
      { message: 'file is empty' }
    );
  });

  await t.test('rejects file that is too large', async () => {
    const file = createMockFile([0xff, 0xd8, 0xff, 0x12, 0x34]);
    await assert.rejects(
      validateAvatarUpload(file, 4), // maxBytes = 4, file is 5
      { message: 'file is too large' }
    );
  });

  await t.test('rejects unsupported file type', async () => {
    const file = createMockFile([0x12, 0x34, 0x56, 0x78]);
    await assert.rejects(
      validateAvatarUpload(file, 100),
      { message: 'unsupported file type' }
    );
  });

  await t.test('rejects incomplete WEBP signature', async () => {
    const file = createMockFile([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // length
      // Missing WEBP at offset 8
      0x58, 0x45, 0x42, 0x50
    ]);
    await assert.rejects(
      validateAvatarUpload(file, 100),
      { message: 'unsupported file type' }
    );
  });
});
