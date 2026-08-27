import { deploymentReadiness } from "@/lib/deployment";
import { ensureSchema, getD1, json } from "@/lib/gitnorm";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = deploymentReadiness();
  let databaseReachable = false;

  if (configured.database) {
    try {
      await ensureSchema();
      await getD1().prepare("SELECT 1 AS ok").first();
      databaseReachable = true;
    } catch {
      databaseReachable = false;
    }
  }

  const ready = configured.ready && databaseReachable;
  return json(
    {
      status: ready ? "ready" : "setup_required",
      checks: {
        databaseConfigured: configured.database,
        databaseReachable,
        archiveStorageConfigured: configured.archives,
        cleanupSecretConfigured: configured.cleanup,
      },
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
    },
    ready ? 200 : 503,
  );
}
