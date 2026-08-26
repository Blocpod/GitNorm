import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type StorageMode = "blob" | "local";

export type StoredObject = {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type StoredObjectHead = Pick<StoredObject, "contentType" | "size">;

const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".gitnorm", "blobs");

export function storageMode(): StorageMode {
  const configured = process.env.GITNORM_STORAGE_MODE?.toLowerCase();
  if (configured === "local" || configured === "blob") return configured;
  return process.env.VERCEL === "1" ? "blob" : "local";
}

function localObjectPath(storageKey: string) {
  if (
    !storageKey ||
    storageKey.includes("\\") ||
    storageKey.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(storageKey) ||
    storageKey.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid storage key.");
  }

  const objectPath = path.resolve(LOCAL_STORAGE_ROOT, storageKey);
  const relative = path.relative(LOCAL_STORAGE_ROOT, objectPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Invalid storage key.");
  return objectPath;
}

function contentTypeFor(storageKey: string) {
  return storageKey.toLowerCase().endsWith(".zip")
    ? "application/zip"
    : "application/octet-stream";
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; name?: string; status?: number };
  return (
    candidate.code === "ENOENT" ||
    candidate.name === "BlobNotFoundError" ||
    candidate.status === 404
  );
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function objectFromBytes(bytes: Uint8Array, contentType: string): StoredObject {
  return {
    size: bytes.byteLength,
    contentType,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    arrayBuffer: async () => bytesToArrayBuffer(bytes),
  };
}

async function blobModule() {
  return import("@vercel/blob");
}

export async function putLocalArchive(
  storageKey: string,
  archive: ArrayBuffer | Uint8Array,
) {
  if (storageMode() !== "local")
    throw new Error("Local archive uploads are disabled for this deployment.");

  const objectPath = localObjectPath(storageKey);
  const bytes =
    archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const temporaryPath = `${objectPath}.${crypto.randomUUID()}.uploading`;
  await mkdir(path.dirname(objectPath), { recursive: true });
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, objectPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    size: bytes.byteLength,
    contentType: "application/zip",
  } satisfies StoredObjectHead;
}

export async function putArchive(
  storageKey: string,
  archive: ArrayBuffer | Uint8Array,
) {
  if (storageMode() === "local") return putLocalArchive(storageKey, archive);
  const bytes =
    archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const { put } = await blobModule();
  const body = new Blob([bytes as BlobPart], { type: "application/zip" });
  await put(storageKey, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/zip",
    multipart: bytes.byteLength > 5 * 1024 * 1024,
  });
  return { size: bytes.byteLength, contentType: "application/zip" };
}

export async function headObject(
  storageKey: string,
): Promise<StoredObjectHead | null> {
  if (storageMode() === "local") {
    try {
      const info = await stat(localObjectPath(storageKey));
      if (!info.isFile()) return null;
      return {
        size: info.size,
        contentType: contentTypeFor(storageKey),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  try {
    const { head } = await blobModule();
    const object = await head(storageKey);
    return {
      size: object.size,
      contentType: object.contentType || contentTypeFor(storageKey),
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getObject(
  storageKey: string,
): Promise<StoredObject | null> {
  if (storageMode() === "local") {
    try {
      const bytes = new Uint8Array(await readFile(localObjectPath(storageKey)));
      return objectFromBytes(bytes, contentTypeFor(storageKey));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  try {
    const { get } = await blobModule();
    const object = await get(storageKey, {
      access: "private",
      useCache: false,
    });
    if (!object || object.statusCode !== 200) return null;
    return {
      size: object.blob.size,
      contentType: object.blob.contentType || contentTypeFor(storageKey),
      body: object.stream,
      arrayBuffer: () => new Response(object.stream).arrayBuffer(),
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function deleteObjects(storageKeys: string[]) {
  const uniqueKeys = [...new Set(storageKeys)];
  if (!uniqueKeys.length) return;

  if (storageMode() === "local") {
    await Promise.all(
      uniqueKeys.map(async (storageKey) => {
        try {
          await unlink(localObjectPath(storageKey));
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }),
    );
    return;
  }

  const { del } = await blobModule();
  await del(uniqueKeys);
}
