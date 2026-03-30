import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

  #objectPath(key: string) {
    return path.join(this.#rootDir, key);
  }

  #metadataPath(key: string) {
    return path.join(this.#rootDir, `${key}.meta.json`);
  }

  async head(key: string): Promise<R2Object | null> {
    const object = await this.get(key);
    return object as unknown as R2Object | null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
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
    await Promise.all(list.flatMap((key) => [
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
