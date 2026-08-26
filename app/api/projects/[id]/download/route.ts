import { currentProfile, ensureSchema, getD1, rateLimit } from "@/lib/gitnorm";
import { getObject } from "@/lib/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensureSchema();
  const { id } = await context.params;
  const user = await currentProfile();
  const share = new URL(request.url).searchParams.get("share");
  if (!(await rateLimit(request, "project-download", 30, 60000)))
    return new Response("Too many downloads. Try again in a minute.", {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  const project = await getD1()
    .prepare(
      "SELECT id,owner_id AS ownerId,slug,title,visibility FROM projects WHERE id=? AND deleted_at IS NULL",
    )
    .bind(id)
    .first<{
      id: string;
      ownerId: string;
      slug: string;
      title: string;
      visibility: string;
    }>();
  if (
    !project ||
    (project.ownerId !== user?.id &&
      !(project.visibility === "public" && share === project.slug))
  )
    return new Response("Not found", { status: 404 });
  const latest = await getD1()
    .prepare(
      "SELECT id FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1",
    )
    .bind(id)
    .first<{ id: string }>();
  if (!latest) return new Response("No files", { status: 404 });
  const archive = await getD1()
    .prepare(
      "SELECT storage_key AS storageKey FROM project_files WHERE version_id=? LIMIT 1",
    )
    .bind(latest.id)
    .first<{ storageKey: string }>();
  if (!archive) return new Response("No files", { status: 404 });
  const object = await getObject(archive.storageKey);
  if (!object) return new Response("No files", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project"}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
