import { closeDatabase, getDatabase } from "../lib/database";
import { migrateDatabase } from "../lib/database-schema";

async function main() {
  await migrateDatabase(getDatabase());
  console.log("GitNorm database schema is up to date.");
}

main()
  .catch((error: unknown) => {
    console.error("GitNorm database migration failed.", error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
