import Database from 'better-sqlite3';

type SqliteValue = string | number | bigint | boolean | Uint8Array | null;

const normalizeValue = (value: unknown): SqliteValue => {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return JSON.stringify(value);
};

const buildMeta = (changes = 0, lastRowId = 0): D1Meta => ({
  duration: 0,
  changes,
  last_row_id: lastRowId,
  changed_db: changes > 0,
  size_after: 0,
  rows_read: 0,
  rows_written: changes,
});

class SqlitePreparedStatement {
  readonly query: string;
  private readonly db: Database.Database;
  private readonly values: SqliteValue[];

  constructor(db: Database.Database, query: string, values: SqliteValue[] = []) {
    this.db = db;
    this.query = query;
    this.values = values;
  }

  getBoundValues() {
    return this.values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqlitePreparedStatement(this.db, this.query, values.map(normalizeValue));
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const statement = this.db.prepare(this.query);
    const row = statement.get(...this.values) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) return ((row[colName] ?? null) as T | null);
    return row as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.query);
    const info = statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: buildMeta(info.changes, Number(info.lastInsertRowid ?? 0)) as D1Meta & Record<string, unknown>,
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.query);
    const results = statement.all(...this.values) as T[];
    return {
      success: true,
      results,
      meta: buildMeta(0, 0) as D1Meta & Record<string, unknown>,
    };
  }

  async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.db.prepare(this.query);
    if (options?.columnNames) {
      const columns = statement.columns().map((column) => column.name);
      const rows = statement.raw(true).all(...this.values) as T[];
      return [columns, ...rows];
    }
    return statement.raw(true).all(...this.values) as T[];
  }
}

export class SqliteD1Database implements D1Database {
  readonly rawDb: Database.Database;

  constructor(filename: string) {
    this.rawDb = new Database(filename);
    this.rawDb.pragma('journal_mode = WAL');
    this.rawDb.pragma('foreign_keys = ON');
  }

  prepare(query: string): D1PreparedStatement {
    return new SqlitePreparedStatement(this.rawDb, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const transaction = this.rawDb.transaction((items: D1PreparedStatement[]) => (
      items.map((statement) => {
        const sqliteStatement = statement as SqlitePreparedStatement;
        const native = this.rawDb.prepare(sqliteStatement.query);
        if (/^\s*select/i.test(sqliteStatement.query) || /^\s*pragma/i.test(sqliteStatement.query)) {
          const results = native.all(...sqliteStatement.getBoundValues()) as T[];
          return {
            success: true,
            results,
            meta: buildMeta(0, 0) as D1Meta & Record<string, unknown>,
          } satisfies D1Result<T>;
        }
        const info = native.run(...sqliteStatement.getBoundValues());
        return {
          success: true,
          results: [],
          meta: buildMeta(info.changes, Number(info.lastInsertRowid ?? 0)) as D1Meta & Record<string, unknown>,
        } satisfies D1Result<T>;
      })
    ));
    return transaction(statements);
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error('D1 dump() is not implemented for self-host mode');
  }

  exec(_query: string): Promise<D1ExecResult> {
    throw new Error('D1 exec() is not implemented for self-host mode');
  }

  withSession(_constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint): D1DatabaseSession {
    throw new Error('D1 sessions are not implemented for self-host mode');
  }
}
