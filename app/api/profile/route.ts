import { cleanHandle, validHandle } from "@/lib/auth";
import {
  cleanupGarbageObjects,
  currentProfile,
  getD1,
  json,
  validMutation,
} from "@/lib/gitnorm";

export async function PATCH(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  const input = (await request.json().catch(() => ({}))) as {
    displayName?: unknown;
    handle?: unknown;
    bio?: unknown;
  };
  const displayName = String(input.displayName ?? profile.displayName)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
  const handle = cleanHandle(input.handle ?? profile.handle);
  const bio = String(input.bio ?? profile.bio)
    .trim()
    .slice(0, 300);
  if (displayName.length < 2)
    return json({ error: "Enter the name you want people to see." }, 400);
  if (!validHandle(handle))
    return json(
      {
        error:
          "Use 3–30 letters, numbers, underscores, or dashes for your handle.",
      },
      400,
    );
  const taken = await getD1()
    .prepare("SELECT id FROM profiles WHERE handle=? AND id<>?")
    .bind(handle, profile.id)
    .first();
  if (taken) return json({ error: "That handle is already taken." }, 409);
  await getD1()
    .prepare(
      "UPDATE profiles SET display_name=?,handle=?,bio=?,updated_at=? WHERE id=?",
    )
    .bind(displayName, handle, bio, Date.now(), profile.id)
    .run();
  return json({
    message: "Profile saved.",
    profile: { ...profile, displayName, handle, bio },
  });
}

export async function DELETE(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in." }, 401);
  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO garbage_objects (storage_key,created_at,delete_after)
         SELECT DISTINCT f.storage_key,?,MAX(?,COALESCE((SELECT MAX(ui.token_expires_at) FROM upload_intents ui WHERE ui.storage_key=f.storage_key),?))
         FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_id=?
         ON CONFLICT(storage_key) DO UPDATE SET delete_after=MAX(delete_after,excluded.delete_after)`,
      )
      .bind(now, now, now, profile.id),
    getD1()
      .prepare(
        `INSERT INTO garbage_objects (storage_key,created_at,delete_after)
         SELECT storage_key,?,CASE WHEN MAX(token_expires_at)>? THEN MAX(token_expires_at) ELSE ? END
         FROM upload_intents WHERE owner_id=? GROUP BY storage_key
         ON CONFLICT(storage_key) DO UPDATE SET delete_after=MAX(delete_after,excluded.delete_after)`,
      )
      .bind(now, now, now, profile.id),
    getD1().prepare("DELETE FROM sessions WHERE user_id=?").bind(profile.id),
    getD1().prepare("DELETE FROM passkeys WHERE user_id=?").bind(profile.id),
    getD1().prepare("DELETE FROM profiles WHERE id=?").bind(profile.id),
  ]);
  await cleanupGarbageObjects(500).catch(() => undefined);
  return json({
    message:
      "Your GitNorm account was deleted. Stored uploads are securely removed after their upload authorizations expire.",
  });
}
