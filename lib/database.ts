import {
  createClient,
  type Client,
  type InStatement,
  type ResultSet,
} from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

type BoundValue =
  string | number | bigint | boolean | null | ArrayBuffer | ArrayBufferView;

type D1CompatibleResult<T = Record<string, unknown>> = {
  success: true;
  results: T[];
  meta: {
    changed_db: boolean;
    changes: number;
    duration: number;
    last_row_id: number;
    rows_read: number;
    rows_written: number;
    size_after: number;
  };
};

export interface D1CompatibleStatement {
  bind(...values: BoundValue[]): D1CompatibleStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1CompatibleResult<T>>;
  run<T = Record<string, unknown>>(): Promise<D1CompatibleResult<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1CompatibleDatabase {
  prepare(sql: string): D1CompatibleStatement;
  batch<T = Record<string, unknown>>(
    statements: D1CompatibleStatement[],
  ): Promise<D1CompatibleResult<T>[]>;
}

function normalizeValue(value: BoundValue) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return value;
}

function normalizeRow<T>(row: unknown, columns: string[]): T {
  if (Array.isArray(row)) {
    return Object.fromEntries(
      columns.map((column, index) => [column, row[index]]),
    ) as T;
  }
  return { ...(row as Record<string, unknown>) } as T;
}

function toD1Result<T>(
  result: ResultSet,
  startedAt: number,
): D1CompatibleResult<T> {
  const changes = Number(result.rowsAffected || 0);
  return {
    success: true,
    results: result.rows.map((row) => normalizeRow<T>(row, result.columns)),
    meta: {
      changed_db: changes > 0,
      changes,
      duration: Math.max(0, performance.now() - startedAt),
      last_row_id: Number(result.lastInsertRowid || 0),
      rows_read: result.rows.length,
      rows_written: changes,
      size_after: 0,
    },
  };
}

class LibsqlD1Statement {
  readonly sql: string;
  readonly values: BoundValue[];

  constructor(
    private readonly client: Client,
    sql: string,
    values: BoundValue[] = [],
  ) {
    this.sql = sql;
    this.values = values;
  }

  bind(...values: BoundValue[]) {
    return new LibsqlD1Statement(this.client, this.sql, values);
  }

  toLibsqlStatement(): InStatement {
    return {
      sql: this.sql,
      args: this.values.map(normalizeValue),
    };
  }

  async first<T = Record<string, unknown>>(
    columnName?: string,
  ): Promise<T | null> {
    const result = await this.client.execute(this.toLibsqlStatement());
    const row = result.rows[0];
    if (!row) return null;
    const normalized = normalizeRow<Record<string, unknown>>(
      row,
      result.columns,
    );
    if (columnName !== undefined) {
      return (normalized[columnName] ?? null) as T | null;
    }
    return normalized as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1CompatibleResult<T>> {
    const startedAt = performance.now();
    const result = await this.client.execute(this.toLibsqlStatement());
    return toD1Result<T>(result, startedAt);
  }

  async run<T = Record<string, unknown>>(): Promise<D1CompatibleResult<T>> {
    return this.all<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const result = await this.client.execute(this.toLibsqlStatement());
    const rows = result.rows.map((row) =>
      result.columns.map((column) => (row as Record<string, unknown>)[column]),
    );
    return (options?.columnNames ? [result.columns, ...rows] : rows) as T[];
  }
}

class LibsqlD1Database {
  constructor(private readonly client: Client) {}

  prepare(sql: string) {
    return new LibsqlD1Statement(this.client, sql);
  }

  async batch<T = Record<string, unknown>>(
    statements: D1CompatibleStatement[],
  ): Promise<D1CompatibleResult<T>[]> {
    if (
      !statements.every((statement) => statement instanceof LibsqlD1Statement)
    ) {
      throw new TypeError(
        "Database batches may only contain prepared GitNorm statements.",
      );
    }
    const startedAt = performance.now();
    const results = await this.client.batch(
      statements.map((statement) =>
        (statement as LibsqlD1Statement).toLibsqlStatement(),
      ),
      "write",
    );
    return results.map((result) => toD1Result<T>(result, startedAt));
  }

  close() {
    this.client.close();
  }
}

let database: LibsqlD1Database | undefined;

function databaseConfig() {
  const configuredUrl = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  const isVercelDeployment = Boolean(process.env.VERCEL_ENV);

  if (isVercelDeployment && !configuredUrl) {
    throw new Error(
      "TURSO_DATABASE_URL is required for Vercel deployments. GitNorm will not use a local ephemeral database in production.",
    );
  }
  if (isVercelDeployment && configuredUrl?.startsWith("file:")) {
    throw new Error(
      "TURSO_DATABASE_URL must point to a remote libSQL/Turso database on Vercel; file: databases are ephemeral there.",
    );
  }
  if (isVercelDeployment && !authToken) {
    throw new Error("TURSO_AUTH_TOKEN is required for Vercel deployments.");
  }

  if (configuredUrl) return { url: configuredUrl, authToken };

  const localPath = resolve(process.cwd(), ".gitnorm", "gitnorm.db");
  mkdirSync(dirname(localPath), { recursive: true });
  return { url: `file:${localPath}` };
}

/**
 * Returns a process-wide libSQL client with the subset of the D1 API used by
 * GitNorm. Client creation and local filesystem setup are deferred until the
 * first database access, so importing server modules remains side-effect free.
 */
export function getDatabase(): D1CompatibleDatabase {
  database ??= new LibsqlD1Database(createClient(databaseConfig()));
  return database;
}

/** Close the singleton client after one-off scripts or tests. */
export function closeDatabase() {
  database?.close();
  database = undefined;
}

export type { D1CompatibleResult };
