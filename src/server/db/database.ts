import { PGlite } from '@electric-sql/pglite';
import { isUuid } from '../domain/pagination';
import { migrations } from './migrations';

/** The only thing services may do with the database: run parameterized SQL. */
export interface Queryable {
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

/**
 * Database access is only possible through one of three doors, and each door
 * opens a transaction with a fixed role:
 *
 *   tenant(workspaceId)  role app_tenant, fenced to that one workspace by
 *                        row-level security
 *   directory()          role app_directory, for sign-in and token lookup
 *   admin                the owner connection, for migrations, seeding and tests
 *
 * Request-handling code receives a Database and can only reach tenant data by
 * naming a workspace, so "forgot the WHERE workspace_id" is not a possible bug.
 */
export interface Database {
  tenant<T>(workspaceId: string, work: (q: Queryable) => Promise<T>): Promise<T>;
  directory<T>(work: (q: Queryable) => Promise<T>): Promise<T>;
  readonly admin: Queryable;
  close(): Promise<void>;
}

interface PgExecutor {
  // The row type is asserted by the caller: SQL results cannot be inferred.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
  exec(sql: string): Promise<unknown>;
}

function asQueryable(executor: PgExecutor): Queryable {
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      const result = await executor.query<Row>(sql, [...params]);
      return result.rows;
    },
  };
}

async function migrate(pg: PGlite): Promise<void> {
  await pg.exec(
    'create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())',
  );
  const applied = await pg.query<{ id: string }>('select id from schema_migrations');
  const done = new Set(applied.rows.map((row) => row.id));
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('insert into schema_migrations (id) values ($1)', [migration.id]);
    });
  }
}

/**
 * Opens the embedded Postgres and brings the schema up to date.
 * @param dataDir a folder for the database files, or "memory" for a throwaway one
 */
export async function openDatabase(dataDir: string): Promise<Database> {
  const pg = dataDir === 'memory' ? new PGlite() : new PGlite(dataDir);
  await pg.waitReady;
  await migrate(pg);

  return {
    admin: asQueryable(pg),

    tenant(workspaceId, work) {
      if (!isUuid(workspaceId)) {
        return Promise.reject(new TypeError('workspaceId must be a UUID'));
      }
      return pg.transaction(async (tx) => {
        await tx.exec('set local role app_tenant');
        await tx.query("select set_config('app.workspace_id', $1, true)", [workspaceId]);
        return work(asQueryable(tx));
      });
    },

    directory(work) {
      return pg.transaction(async (tx) => {
        await tx.exec('set local role app_directory');
        return work(asQueryable(tx));
      });
    },

    async close() {
      await pg.close();
    },
  };
}
