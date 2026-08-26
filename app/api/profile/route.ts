import { cleanHandle, validHandle } from "@/lib/auth";
import {
  currentProfile,
  deleteProjectFully,
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
  const projects = await getD1()
    .prepare("SELECT id FROM projects WHERE owner_id=?")
    .bind(profile.id)
    .all<{ id: string }>();
  for (const project of projects.results)
    await deleteProjectFully(project.id, profile.id);
  await getD1().batch([
    getD1().prepare("DELETE FROM sessions WHERE user_id=?").bind(profile.id),
    getD1().prepare("DELETE FROM passkeys WHERE user_id=?").bind(profile.id),
    getD1().prepare("DELETE FROM profiles WHERE id=?").bind(profile.id),
  ]);
  return json({
    message:
      "Your GitNorm account and stored projects were permanently deleted.",
  });
}
