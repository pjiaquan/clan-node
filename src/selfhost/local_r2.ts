import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSafeStorageKey } from '../storage_keys';

type StoredMetadata = {
  contentType?: string;
};

const ensureParentDir = async (filePath: string) => {
  await mkdir(path.dirname(filePath), { recursive: true });
};

const streamToBuffer = async (value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null) => {
  if (value === null) return Buffer.alloc(0);
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);

  const reader = value.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

class LocalR2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };

  constructor(buffer: Buffer, metadata: StoredMetadata) {
    this.body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
    this.httpMetadata = { contentType: metadata.contentType };
  }
}

export class LocalR2Bucket implements R2Bucket {
  #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  /**
   * Resolves a bucket key to a path inside the root directory.
   *
   * Keys are validated and the resolved path is asserted to stay under the
   * root, so a key such as `../clan-node.sqlite` cannot reach the SQLite
   * database or any other file outside the avatar directory.
   */
  #resolveWithinRoot(relativePath: string, key: string) {
    if (!isSafeStorageKey(key)) {
      throw new Error('invalid storage key');
    }
    const root = path.resolve(this.#rootDir);
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('invalid storage key');
    }
    return resolved;
  }

  #objectPath(key: string) {
    return this.#resolveWithinRoot(key, key);
  }

  #metadataPath(key: string) {
    return this.#resolveWithinRoot(`${key}.meta.json`, key);
  }

  async head(key: string): Promise<R2Object | null> {
    const object = await this.get(key);
    return object as unknown as R2Object | null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    if (!isSafeStorageKey(key)) return null;
    const objectPath = this.#objectPath(key);
    try {
      await stat(objectPath);
    } catch {
      return null;
    }
    const [buffer, metadataRaw] = await Promise.all([
      readFile(objectPath),
      readFile(this.#metadataPath(key), 'utf8').catch(() => '{}'),
    ]);
    const metadata = JSON.parse(metadataRaw) as StoredMetadata;
    return new LocalR2ObjectBody(buffer, metadata) as unknown as R2ObjectBody;
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    const objectPath = this.#objectPath(key);
    await ensureParentDir(objectPath);
    const buffer = await streamToBuffer(value);
    await writeFile(objectPath, buffer);
    await writeFile(
      this.#metadataPath(key),
      JSON.stringify({
        contentType: options?.httpMetadata instanceof Headers
          ? options.httpMetadata.get('content-type') ?? undefined
          : options?.httpMetadata?.contentType ?? undefined,
      }),
      'utf8',
    );
    const object = await this.get(key);
    return object as unknown as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    // Skip rather than throw: an unsafe key stored in D1 must not be able to
    // delete a file outside the bucket, but it also must not make deleting the
    // owning person or layer fail.
    await Promise.all(list.filter(isSafeStorageKey).flatMap((key) => [
      rm(this.#objectPath(key), { force: true }),
      rm(this.#metadataPath(key), { force: true }),
    ]));
  }

  createMultipartUpload(): Promise<R2MultipartUpload> {
    throw new Error('Multipart uploads are not implemented for self-host mode');
  }

  resumeMultipartUpload(): R2MultipartUpload {
    throw new Error('Multipart uploads are not implemented for self-host mode');
  }

  list(): Promise<R2Objects> {
    throw new Error('Bucket listing is not implemented for self-host mode');
  }
}
