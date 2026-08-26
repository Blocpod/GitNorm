import {
  allocateVersionNumber,
  currentProfile,
  getD1,
  json,
  makeId,
  MAX_VERSIONS,
  validMutation,
} from "@/lib/gitnorm";
import {
  markUploadCommitted,
  releaseUploadClaim,
  verifiedUploadIntent,
} from "@/lib/uploads";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
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

  let activeIntentId = "";
  try {
    const body = (await request.json()) as {
      restoreVersionId?: string;
      intentId?: string;
      note?: string;
    };
    if (body.restoreVersionId) {
      const source = await getD1()
        .prepare(
          "SELECT id,number,file_count AS fileCount,total_size AS totalSize FROM versions WHERE id=? AND project_id=?",
        )
        .bind(body.restoreVersionId, id)
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
      const versionId = makeId("ver");
      const now = Date.now();
      const number = await allocateVersionNumber(id);
      await getD1().batch([
        getD1()
          .prepare(
            "INSERT INTO versions (id,project_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            versionId,
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
      return json({
        message: `Saved version ${source.number} is now your newest version. Nothing was deleted.`,
      });
    }

    if (!body.intentId)
      return json({ error: "Choose the updated project folder first." }, 400);
    const { intent, archive } = await verifiedUploadIntent({
      intentId: body.intentId,
      ownerId: profile.id,
      operation: "create_version",
      projectId: id,
    });
    activeIntentId = intent.id;
    const latest = await getD1()
      .prepare(
        "SELECT id FROM versions WHERE project_id=? ORDER BY number DESC LIMIT 1",
      )
      .bind(id)
      .first<{ id: string }>();
    const previous = latest
      ? await getD1()
          .prepare("SELECT path,hash FROM project_files WHERE version_id=?")
          .bind(latest.id)
          .all<{ path: string; hash: string }>()
      : { results: [] };
    const before = new Map(
      previous.results.map((file) => [file.path, file.hash]),
    );
    let added = 0;
    let changed = 0;
    for (const file of archive.files) {
      if (!before.has(file.path)) added += 1;
      else if (before.get(file.path) !== file.hash) changed += 1;
      before.delete(file.path);
    }
    const removed = before.size;
    const summary =
      [
        added && `${added} added`,
        changed && `${changed} updated`,
        removed && `${removed} removed`,
      ]
        .filter(Boolean)
        .join(" · ") || "No file changes";
    const versionId = makeId("ver");
    const now = Date.now();
    const number = await allocateVersionNumber(id);
    const note = String(body.note || "Added an update")
      .trim()
      .slice(0, 160);
    await getD1().batch([
      getD1()
        .prepare(
          "INSERT INTO versions (id,project_id,upload_intent_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          versionId,
          id,
          intent.id,
          number,
          note,
          summary,
          archive.fileCount,
          archive.totalSize,
          now,
        ),
      ...archive.files.map((file) =>
        getD1()
          .prepare(
            "INSERT INTO project_files (id,version_id,project_id,path,storage_key,hash,mime_type,size) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            makeId("fil"),
            versionId,
            id,
            file.path,
            intent.storageKey,
            file.hash,
            file.mimeType,
            file.size,
          ),
      ),
      getD1()
        .prepare("UPDATE projects SET updated_at=? WHERE id=? AND owner_id=?")
        .bind(now, id, profile.id),
      markUploadCommitted(intent.id, now),
    ]);
    return json({ message: `New saved version created: ${summary}.`, summary });
  } catch (error) {
    if (activeIntentId) await releaseUploadClaim(activeIntentId);
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
