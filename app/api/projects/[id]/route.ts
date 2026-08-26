import {
  currentProfile,
  deleteProjectFully,
  ensureSchema,
  getD1,
  json,
  validMutation,
} from "@/lib/gitnorm";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  await ensureSchema();
  const { id } = await context.params;
  const project = await getD1()
    .prepare(
      `SELECT id,slug,title,description,about,icon,accent,visibility,created_at AS createdAt,updated_at AS updatedAt FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL`,
    )
    .bind(id, profile.id)
    .first();
  if (!project) return json({ error: "We could not find that project." }, 404);
  const versions = await getD1()
    .prepare(
      `SELECT id,number,note,summary,file_count AS fileCount,total_size AS totalSize,created_at AS createdAt FROM versions WHERE project_id=? ORDER BY number DESC`,
    )
    .bind(id)
    .all();
  const latest = versions.results[0] as { id: string } | undefined;
  const files = latest
    ? await getD1()
        .prepare(
          `SELECT id,path,mime_type AS mimeType,size FROM project_files WHERE version_id=? ORDER BY path`,
        )
        .bind(latest.id)
        .all()
    : { results: [] };
  return json({ project, versions: versions.results, files: files.results });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  const { id } = await context.params;
  const input = (await request.json()) as {
    title?: string;
    description?: string;
    about?: string;
    visibility?: string;
  };
  const current = await getD1()
    .prepare(
      "SELECT id,title,description,about,visibility FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL",
    )
    .bind(id, profile.id)
    .first<{
      id: string;
      title: string;
      description: string;
      about: string;
      visibility: string;
    }>();
  if (!current) return json({ error: "We could not find that project." }, 404);
  const title = String(input.title ?? current.title)
    .trim()
    .slice(0, 80);
  if (!title) return json({ error: "Your project needs a name." }, 400);
  const visibility =
    input.visibility === "public"
      ? "public"
      : input.visibility === "private"
        ? "private"
        : current.visibility;
  await getD1()
    .prepare(
      "UPDATE projects SET title=?,description=?,about=?,visibility=?,updated_at=? WHERE id=? AND owner_id=?",
    )
    .bind(
      title,
      String(input.description ?? current.description)
        .trim()
        .slice(0, 220),
      String(input.about ?? current.about)
        .trim()
        .slice(0, 4000),
      visibility,
      Date.now(),
      id,
      profile.id,
    )
    .run();
  return json({
    message:
      visibility === "public"
        ? "Your project is now public."
        : "Your changes are saved.",
    visibility,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  const { id } = await context.params;
  if (!(await deleteProjectFully(id, profile.id)))
    return json({ error: "We could not find that project." }, 404);
  return json({
    message:
      "Project removed. Stored uploads are securely deleted after their upload authorizations expire.",
  });
}
