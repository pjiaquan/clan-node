type ValidatedAvatarUpload = {
  buffer: ArrayBuffer;
  bytes: Uint8Array;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
};

const matchesSignature = (bytes: Uint8Array, signature: number[], offset = 0) => (
  bytes.length >= offset + signature.length
  && signature.every((value, index) => bytes[offset + index] === value)
);

const detectAvatarMime = (bytes: Uint8Array): ValidatedAvatarUpload['contentType'] | null => {
  if (matchesSignature(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (matchesSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (
    matchesSignature(bytes, [0x52, 0x49, 0x46, 0x46])
    && matchesSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
};

const mimeToExtension: Record<ValidatedAvatarUpload['contentType'], ValidatedAvatarUpload['extension']> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

export const validateAvatarUpload = async (
  file: Pick<Blob, 'arrayBuffer'>,
  maxBytes: number
): Promise<ValidatedAvatarUpload> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength === 0) {
    throw new Error('file is empty');
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error('file is too large');
  }
  const contentType = detectAvatarMime(bytes);
  if (!contentType) {
    throw new Error('unsupported file type');
  }
  return {
    buffer,
    bytes,
    contentType,
    extension: mimeToExtension[contentType]
  };
};
