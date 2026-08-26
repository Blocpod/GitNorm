import { currentProfile, ensureSchema, getD1, rateLimit } from "@/lib/gitnorm";
import { extractArchiveFile } from "@/lib/archive";
import { getObject } from "@/lib/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await context.params;
  if (!(await rateLimit(request, "file-read", 20, 60_000)))
    return new Response("Too many file requests. Try again in a minute.", {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  const user = await currentProfile();
  const file = await getD1()
    .prepare(
      `SELECT f.path,f.storage_key AS storageKey,f.hash,f.size,f.mime_type AS mimeType,p.owner_id AS ownerId,p.visibility,v.number,(SELECT MAX(number) FROM versions WHERE project_id=p.id) AS latest FROM project_files f JOIN versions v ON v.id=f.version_id JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.deleted_at IS NULL`,
    )
    .bind(id)
    .first<{
      path: string;
      storageKey: string;
      mimeType: string;
      hash: string;
      size: number;
      ownerId: string;
      visibility: string;
      number: number;
      latest: number;
    }>();
  if (
    !file ||
    (file.ownerId !== user?.id &&
      !(file.visibility === "public" && file.number === file.latest))
  )
    return new Response("Not found", { status: 404 });
  const object = await getObject(file.storageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const entry = extractArchiveFile(await object.arrayBuffer(), file.path);
  if (!entry || entry.hash !== file.hash || entry.size !== file.size)
    return new Response("Not found", { status: 404 });
  const safeInline =
    /^(text\/plain|application\/json|image\/(png|jpeg|gif|webp))/.test(
      file.mimeType,
    );
  const type = safeInline ? file.mimeType : "application/octet-stream";
  const name = (file.path.split("/").pop() || "file").replace(
    /[\u0000-\u001f\u007f"\\]/g,
    "_",
  );
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= entry.bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + 64 * 1024, entry.bytes.byteLength);
      controller.enqueue(entry.bytes.slice(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
