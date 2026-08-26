import {
  currentProfile,
  ensureSchema,
  getD1,
  getFilesBucket,
  json,
  makeId,
  makeSlug,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_PROJECT_SIZE,
  MAX_PROJECTS,
  requestBodyAllowed,
  safePath,
  sha256,
  validMutation,
} from "@/lib/gitnorm";

export async function GET(request: Request) {
  await ensureSchema();
  const discover = new URL(request.url).searchParams.get("discover") === "1";
  if (discover) {
    const result = await getD1()
      .prepare(
        `SELECT p.id,p.slug,p.title,p.description,p.icon,p.accent,p.updated_at AS updatedAt,pr.display_name AS creator,pr.handle,v.file_count AS fileCount FROM projects p JOIN profiles pr ON pr.id=p.owner_id LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.visibility='public' AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 24`,
      )
      .all();
    return json({ projects: result.results });
  }
  const profile = await currentProfile();
  if (!profile)
    return json({ error: "Please sign in to see your projects." }, 401);
  const result = await getD1()
    .prepare(
      `SELECT p.id,p.slug,p.title,p.description,p.about,p.icon,p.accent,p.visibility,p.created_at AS createdAt,p.updated_at AS updatedAt,v.number AS version,v.file_count AS fileCount,v.total_size AS totalSize FROM projects p LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.owner_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
    )
    .bind(profile.id)
    .all();
  return json({ profile, projects: result.results });
}

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  if (!requestBodyAllowed(request))
    return json({ error: "That upload is too large for GitNorm." }, 413);
  const profile = await currentProfile();
  if (!profile)
    return json({ error: "Please sign in before adding a project." }, 401);
  const projectCount = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND deleted_at IS NULL",
    )
    .bind(profile.id)
    .first<{ count: number }>();
  if ((projectCount?.count || 0) >= MAX_PROJECTS)
    return json(
      {
        error: `GitNorm currently supports up to ${MAX_PROJECTS} active projects per account.`,
      },
      409,
    );
  try {
    const form = await request.formData();
    const title = String(form.get("title") || "")
      .trim()
      .slice(0, 80);
    const description = String(form.get("description") || "")
      .trim()
      .slice(0, 220);
    const visibility =
      form.get("visibility") === "public" ? "public" : "private";
    const note = String(form.get("note") || "First saved version")
      .trim()
      .slice(0, 160);
    const files = form
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size >= 0);
    const paths = form.getAll("paths").map(String);
    if (!title) return json({ error: "Give your project a name first." }, 400);
    if (!files.length)
      return json({ error: "Choose at least one file to save." }, 400);
    if (files.length > MAX_FILES)
      return json(
        {
          error: `That project has more than ${MAX_FILES} files. Try a smaller folder for now.`,
        },
        400,
      );
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_PROJECT_SIZE)
      return json(
        {
          error:
            "That project is over 30 MB. Try removing large files and add it again.",
        },
        400,
      );
    if (files.some((file) => file.size > MAX_FILE_SIZE))
      return json(
        { error: "One of those files is over 8 MB. Remove it and try again." },
        400,
      );

    const projectId = makeId("prj");
    const versionId = makeId("ver");
    const now = Date.now();
    const saved: Array<{
      id: string;
      path: string;
      storageKey: string;
      hash: string;
      mimeType: string;
      size: number;
    }> = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const path = safePath(paths[index] || file.name);
      const bytes = await file.arrayBuffer();
      const hash = await sha256(bytes);
      const storageKey = `projects/${projectId}/blobs/${hash}`;
      if (!(await getFilesBucket().head(storageKey)))
        await getFilesBucket().put(storageKey, bytes, {
          httpMetadata: {
            contentType: file.type || "application/octet-stream",
          },
        });
      saved.push({
        id: makeId("fil"),
        path,
        storageKey,
        hash,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      });
    }
    const iconChoices = ["✦", "◒", "⌁", "✿", "◆"];
    const accentChoices = ["mint", "sun", "lilac", "coral", "sky"];
    const statements = [
      getD1()
        .prepare(
          `INSERT INTO projects (id,owner_id,slug,title,description,about,icon,accent,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          projectId,
          profile.id,
          makeSlug(title),
          title,
          description,
          "",
          iconChoices[Math.floor(Math.random() * iconChoices.length)],
          accentChoices[Math.floor(Math.random() * accentChoices.length)],
          visibility,
          now,
          now,
        ),
      getD1()
        .prepare(
          "INSERT INTO project_version_counters (project_id,next_version) VALUES (?,2)",
        )
        .bind(projectId),
      getD1()
        .prepare(
          `INSERT INTO versions (id,project_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          versionId,
          projectId,
          1,
          note,
          `${files.length} files safely saved`,
          files.length,
          total,
          now,
        ),
      ...saved.map((file) =>
        getD1()
          .prepare(
            `INSERT INTO project_files (id,version_id,project_id,path,storage_key,hash,mime_type,size) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .bind(
            file.id,
            versionId,
            projectId,
            file.path,
            file.storageKey,
            file.hash,
            file.mimeType,
            file.size,
          ),
      ),
    ];
    await getD1().batch(statements);
    return json(
      { id: projectId, message: "Your project is safely saved." },
      201,
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "We could not save that project. Your files are still safe on your device.",
      },
      400,
    );
  }
}
