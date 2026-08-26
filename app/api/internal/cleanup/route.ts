import { cleanupGarbageObjects, ensureSchema, json } from "@/lib/gitnorm";
import { cleanupExpiredUploads } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return json({ error: "Not found." }, 404);
  await ensureSchema();
  const expiredUploads = await cleanupExpiredUploads(Date.now(), 500);
  const deletedObjects = await cleanupGarbageObjects(500);
  return json({ ok: true, expiredUploads, deletedObjects });
}
