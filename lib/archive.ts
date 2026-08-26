import { createHash } from "node:crypto";

import { unzipSync, zipSync, type UnzipFileInfo } from "fflate";

export const MAX_ARCHIVE_FILES = 250;
export const MAX_ARCHIVE_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_ARCHIVE_EXPANDED_SIZE = 30 * 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 34 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 200;

export type ValidatedArchiveFile = {
  path: string;
  size: number;
  compressedSize: number;
  hash: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type ValidatedArchive = {
  archiveSize: number;
  fileCount: number;
  totalSize: number;
  files: ValidatedArchiveFile[];
};

export function canonicalArchiveBytes(archive: ValidatedArchive) {
  const files = Object.fromEntries(
    archive.files.map((file) => [file.path, file.bytes]),
  );
  return zipSync(files, { level: 6 });
}

export class ArchiveValidationError extends Error {
  readonly code:
    | "ARCHIVE_TOO_LARGE"
    | "COMPRESSION_RATIO"
    | "DUPLICATE_PATH"
    | "EMPTY_ARCHIVE"
    | "EXPANDED_TOO_LARGE"
    | "FILE_TOO_LARGE"
    | "INVALID_ARCHIVE"
    | "TOO_MANY_FILES"
    | "UNSAFE_PATH";

  constructor(
    message: string,
    code:
      | "ARCHIVE_TOO_LARGE"
      | "COMPRESSION_RATIO"
      | "DUPLICATE_PATH"
      | "EMPTY_ARCHIVE"
      | "EXPANDED_TOO_LARGE"
      | "FILE_TOO_LARGE"
      | "INVALID_ARCHIVE"
      | "TOO_MANY_FILES"
      | "UNSAFE_PATH",
  ) {
    super(message);
    this.name = "ArchiveValidationError";
    this.code = code;
  }
}

export function normalizeArchivePath(rawPath: string) {
  const value = rawPath.normalize("NFC").replaceAll("\\", "/");
  const parts = value.split("/");
  const lowerParts = parts.map((part) => part.toLowerCase());
  const sensitive =
    lowerParts.some(
      (part) =>
        [".git", "node_modules", ".next", ".turbo", "__macosx"].includes(
          part,
        ) || /^\.env(?:\.|$)/.test(part),
    ) ||
    /(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(value) ||
    /\.(pem|key|p12|pfx)$/i.test(value);

  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:\//i.test(value) ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    parts.some((part) => !part || part === "." || part === "..") ||
    sensitive
  ) {
    throw new ArchiveValidationError(
      "GitNorm blocked a sensitive, generated, or unsafe file path.",
      "UNSAFE_PATH",
    );
  }
  return value;
}

export function inferMimeType(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const types: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    css: "text/css; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    gif: "image/gif",
    htm: "text/html; charset=utf-8",
    html: "text/html; charset=utf-8",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    jsx: "text/jsx; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    toml: "application/toml; charset=utf-8",
    ts: "text/typescript; charset=utf-8",
    tsx: "text/tsx; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    wasm: "application/wasm",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
    xml: "application/xml; charset=utf-8",
    yaml: "application/yaml; charset=utf-8",
    yml: "application/yaml; charset=utf-8",
  };
  return types[extension] || "application/octet-stream";
}

function archiveBytes(input: ArrayBuffer | Uint8Array) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateProjectArchive(
  input: ArrayBuffer | Uint8Array,
): ValidatedArchive {
  const archive = archiveBytes(input);
  if (archive.byteLength > MAX_ARCHIVE_SIZE)
    throw new ArchiveValidationError(
      `That archive is larger than GitNorm's ${MAX_ARCHIVE_SIZE / 1024 / 1024} MB upload limit.`,
      "ARCHIVE_TOO_LARGE",
    );

  const metadata = new Map<
    string,
    { compressedSize: number; originalSize: number }
  >();
  let totalSize = 0;
  let fileCount = 0;

  const filter = (entry: UnzipFileInfo) => {
    if (entry.name.endsWith("/")) return false;
    const filePath = normalizeArchivePath(entry.name);
    if (metadata.has(filePath))
      throw new ArchiveValidationError(
        `The archive contains the path ${filePath} more than once.`,
        "DUPLICATE_PATH",
      );

    fileCount += 1;
    if (fileCount > MAX_ARCHIVE_FILES)
      throw new ArchiveValidationError(
        `That archive has more than ${MAX_ARCHIVE_FILES} files.`,
        "TOO_MANY_FILES",
      );
    if (entry.originalSize > MAX_ARCHIVE_FILE_SIZE)
      throw new ArchiveValidationError(
        `${filePath} is larger than GitNorm's per-file limit.`,
        "FILE_TOO_LARGE",
      );

    totalSize += entry.originalSize;
    if (totalSize > MAX_ARCHIVE_EXPANDED_SIZE)
      throw new ArchiveValidationError(
        `The expanded project is larger than GitNorm's ${MAX_ARCHIVE_EXPANDED_SIZE / 1024 / 1024} MB limit.`,
        "EXPANDED_TOO_LARGE",
      );

    const ratio =
      entry.originalSize === 0
        ? 1
        : entry.size === 0
          ? Number.POSITIVE_INFINITY
          : entry.originalSize / entry.size;
    if (ratio > MAX_COMPRESSION_RATIO)
      throw new ArchiveValidationError(
        `${filePath} is compressed at an unsafe ratio.`,
        "COMPRESSION_RATIO",
      );

    metadata.set(filePath, {
      compressedSize: entry.size,
      originalSize: entry.originalSize,
    });
    return true;
  };

  let expanded: Record<string, Uint8Array>;
  try {
    expanded = unzipSync(archive, { filter });
  } catch (error) {
    if (error instanceof ArchiveValidationError) throw error;
    throw new ArchiveValidationError(
      "GitNorm could not read that ZIP archive.",
      "INVALID_ARCHIVE",
    );
  }

  if (!fileCount)
    throw new ArchiveValidationError(
      "That ZIP archive does not contain any files.",
      "EMPTY_ARCHIVE",
    );

  const files = Object.entries(expanded).map(([rawPath, bytes]) => {
    const filePath = normalizeArchivePath(rawPath);
    const info = metadata.get(filePath);
    if (!info || bytes.byteLength !== info.originalSize)
      throw new ArchiveValidationError(
        `GitNorm could not safely verify ${filePath}.`,
        "INVALID_ARCHIVE",
      );
    return {
      path: filePath,
      size: bytes.byteLength,
      compressedSize: info.compressedSize,
      hash: sha256(bytes),
      mimeType: inferMimeType(filePath),
      bytes,
    } satisfies ValidatedArchiveFile;
  });
  files.sort((left, right) => left.path.localeCompare(right.path));

  if (files.length !== fileCount)
    throw new ArchiveValidationError(
      "GitNorm could not safely verify every file in that ZIP archive.",
      "INVALID_ARCHIVE",
    );

  return {
    archiveSize: archive.byteLength,
    fileCount,
    totalSize,
    files,
  };
}

export function extractArchiveFile(
  input: ArrayBuffer | Uint8Array,
  requestedPath: string,
) {
  const safeRequestedPath = normalizeArchivePath(requestedPath);
  const archive = archiveBytes(input);
  if (archive.byteLength > MAX_ARCHIVE_SIZE)
    throw new ArchiveValidationError(
      "That stored archive is larger than GitNorm's limit.",
      "ARCHIVE_TOO_LARGE",
    );
  let metadata: { compressedSize: number; originalSize: number } | undefined;
  let expanded: Record<string, Uint8Array>;
  try {
    expanded = unzipSync(archive, {
      filter(entry) {
        if (entry.name.endsWith("/")) return false;
        const filePath = normalizeArchivePath(entry.name);
        if (filePath !== safeRequestedPath) return false;
        if (entry.originalSize > MAX_ARCHIVE_FILE_SIZE)
          throw new ArchiveValidationError(
            "That stored file is larger than GitNorm's limit.",
            "FILE_TOO_LARGE",
          );
        const ratio = entry.originalSize / Math.max(entry.size, 1);
        if (ratio > MAX_COMPRESSION_RATIO)
          throw new ArchiveValidationError(
            "That stored file is compressed at an unsafe ratio.",
            "COMPRESSION_RATIO",
          );
        metadata = {
          compressedSize: entry.size,
          originalSize: entry.originalSize,
        };
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ArchiveValidationError) throw error;
    throw new ArchiveValidationError(
      "GitNorm could not read that stored ZIP archive.",
      "INVALID_ARCHIVE",
    );
  }
  const bytes = expanded[safeRequestedPath];
  if (!bytes || !metadata || bytes.byteLength !== metadata.originalSize)
    return null;
  return {
    path: safeRequestedPath,
    size: bytes.byteLength,
    compressedSize: metadata.compressedSize,
    hash: sha256(bytes),
    mimeType: inferMimeType(safeRequestedPath),
    bytes,
  } satisfies ValidatedArchiveFile;
}
