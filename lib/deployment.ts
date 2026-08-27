export type DeploymentReadiness = {
  ready: boolean;
  database: boolean;
  archives: boolean;
  cleanup: boolean;
};

function isVercelDeployment() {
  return Boolean(process.env.VERCEL_ENV || process.env.VERCEL === "1");
}

/**
 * Reports whether production has the durable resources GitNorm requires.
 * Local development intentionally uses SQLite and the local filesystem.
 */
export function deploymentReadiness(): DeploymentReadiness {
  if (!isVercelDeployment()) {
    return { ready: true, database: true, archives: true, cleanup: true };
  }

  const databaseUrl = process.env.TURSO_DATABASE_URL?.trim();
  const database = Boolean(
    databaseUrl &&
    !databaseUrl.startsWith("file:") &&
    process.env.TURSO_AUTH_TOKEN?.trim(),
  );
  const archives = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const cleanup = Boolean(process.env.CRON_SECRET?.trim());

  return {
    ready: database && archives,
    database,
    archives,
    cleanup,
  };
}
