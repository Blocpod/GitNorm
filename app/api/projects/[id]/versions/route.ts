import {
  allocateVersionNumber,
  currentProfile,
  getD1,
  getFilesBucket,
  json,
  makeId,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_PROJECT_SIZE,
  MAX_VERSIONS,
  requestBodyAllowed,
  safePath,
  sha256,
  validMutation,
} from "@/lib/gitnorm";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  if (!requestBodyAllowed(request))
    return json({ error: "That upload is too large for GitNorm." }, 413);
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  const { id } = await context.params;
  const project = await getD1()
    .prepare(
      "SELECT id FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL",
    )
    .bind(id, profile.id)
    .first();
  if (!project) return json({ error: "We could not find that project." }, 404);
  const versionCount = await getD1()
    .prepare("SELECT COUNT(*) AS count FROM versions WHERE project_id=?")
    .bind(id)
    .first<{ count: number }>();
  if ((versionCount?.count || 0) >= MAX_VERSIONS)
    return json(
      {
        error: `This project has reached its ${MAX_VERSIONS}-version limit. Download it before removing older history.`,
      },
      409,
    );
  try {
    const contentType = request.headers.get("content-type") || "";
    const latest = await getD1()
      .prepare(
        "SELECT id,number FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1",
      )
      .bind(id)
      .first<{ id: string; number: number }>();
    if (contentType.includes("application/json")) {
      const { restoreVersionId } = (await request.json()) as {
        restoreVersionId?: string;
      };
      const source = await getD1()
        .prepare(
          "SELECT id,number,file_count AS fileCount,total_size AS totalSize FROM versions WHERE id=? AND project_id=?",
        )
        .bind(restoreVersionId || "", id)
        .first<{
          id: string;
          number: number;
          fileCount: number;
          totalSize: number;
        }>();
      if (!source)
        return json(
          { error: "That saved version is no longer available." },
          404,
        );
      const newVersionId = makeId("ver");
      const now = Date.now();
      const number = await allocateVersionNumber(id);
      const sourceFiles = await getD1()
        .prepare(
          "SELECT path,storage_key AS storageKey,hash,mime_type AS mimeType,size FROM project_files WHERE version_id=?",
        )
        .bind(source.id)
        .all<{
          path: string;
          storageKey: string;
          hash: string;
          mimeType: string;
          size: number;
        }>();
      await getD1().batch([
        getD1()
          .prepare(
            "INSERT INTO versions (id,project_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            newVersionId,
            id,
            number,
            `Restored saved version ${source.number}`,
            `Made a safe copy of version ${source.number}`,
            source.fileCount,
            source.totalSize,
            now,
          ),
        ...sourceFiles.results.map((file) =>
          getD1()
            .prepare(
              "INSERT INTO project_files (id,version_id,project_id,path,storage_key,hash,mime_type,size) VALUES (?,?,?,?,?,?,?,?)",
            )
            .bind(
              makeId("fil"),
              newVersionId,
              id,
              file.path,
              file.storageKey,
              file.hash,
              file.mimeType,
              file.size,
            ),
        ),
        getD1()
          .prepare("UPDATE projects SET updated_at=? WHERE id=? AND owner_id=?")
          .bind(now, id, profile.id),
      ]);
      return json({
        message: `Saved version ${source.number} is now your newest version. Nothing was deleted.`,
      });
    }

    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((item): item is File => item instanceof File);
    const paths = form.getAll("paths").map(String);
    const note = String(form.get("note") || "Added an update")
      .trim()
      .slice(0, 160);
    if (!files.length)
      return json({ error: "Choose the updated project folder first." }, 400);
    if (files.length > MAX_FILES)
      return json(
        { error: `That update has more than ${MAX_FILES} files.` },
        400,
      );
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (
      total > MAX_PROJECT_SIZE ||
      files.some((file) => file.size > MAX_FILE_SIZE)
    )
      return json(
        {
          error:
            "That update is too large. Keep it under 30 MB, with no single file over 8 MB.",
        },
        400,
      );
    const previous = latest
      ? await getD1()
          .prepare("SELECT path,hash FROM project_files WHERE version_id=?")
          .bind(latest.id)
          .all<{ path: string; hash: string }>()
      : { results: [] };
    const before = new Map(
      previous.results.map((file) => [file.path, file.hash]),
    );
    const versionId = makeId("ver");
    const saved: Array<{
      id: string;
      path: string;
      storageKey: string;
      hash: string;
      mimeType: string;
      size: number;
    }> = [];
    let added = 0,
      changed = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const path = safePath(paths[index] || file.name);
      const bytes = await file.arrayBuffer();
      const hash = await sha256(bytes);
      const storageKey = `projects/${id}/blobs/${hash}`;
      if (!(await getFilesBucket().head(storageKey)))
        await getFilesBucket().put(storageKey, bytes, {
          httpMetadata: {
            contentType: file.type || "application/octet-stream",
          },
        });
      if (!before.has(path)) added++;
      else if (before.get(path) !== hash) changed++;
      before.delete(path);
      saved.push({
        id: makeId("fil"),
        path,
        storageKey,
        hash,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });
    }
    const removed = before.size;
    const now = Date.now();
    const number = await allocateVersionNumber(id);
    const summary =
      [
        added && `${added} added`,
        changed && `${changed} updated`,
        removed && `${removed} removed`,
      ]
        .filter(Boolean)
        .join(" · ") || "No file changes";
    await getD1().batch([
      getD1()
        .prepare(
          "INSERT INTO versions (id,project_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(versionId, id, number, note, summary, files.length, total, now),
      ...saved.map((file) =>
        getD1()
          .prepare(
            "INSERT INTO project_files (id,version_id,project_id,path,storage_key,hash,mime_type,size) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            file.id,
            versionId,
            id,
            file.path,
            file.storageKey,
            file.hash,
            file.mimeType,
            file.size,
          ),
      ),
      getD1()
        .prepare("UPDATE projects SET updated_at=? WHERE id=? AND owner_id=?")
        .bind(now, id, profile.id),
    ]);
    return json({ message: `New saved version created: ${summary}.`, summary });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "We could not save that update. Your previous version is still safe.",
      },
      400,
    );
  }
}
