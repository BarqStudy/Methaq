import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const placeholders = sql => {
  let index = 0;
  return sql.replace(/\?/g, () => '$'+(++index));
};

export async function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const path = process.env.DATABASE_PATH || 'data/methaq.sqlite';
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    const sqlite = new DatabaseSync(path);
    return {
      kind:'sqlite',
      exec: async sql => sqlite.exec(sql),
      query: async (sql,...args) => sqlite.prepare(sql).get(...args),
      all: async (sql,...args) => sqlite.prepare(sql).all(...args),
      run: async (sql,...args) => sqlite.prepare(sql).run(...args),
      transaction: async fn => {
        sqlite.exec('BEGIN');
        try { const value=await fn(); sqlite.exec('COMMIT'); return value; }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
      close: async () => sqlite.close()
    };
  }

  const pool = new pg.Pool({
    connectionString,
    ssl:{rejectUnauthorized:false},
    max:Number(process.env.DATABASE_POOL_SIZE || 8),
    connectionTimeoutMillis:10000,
    idleTimeoutMillis:30000
  });
  const context = new AsyncLocalStorage();
  const client = () => context.getStore() || pool;
  const execute = async (sql,args=[]) => client().query(placeholders(sql),args);
  await pool.query('SELECT 1');
  return {
    kind:'postgres',
    exec: async sql => client().query(sql),
    query: async (sql,...args) => (await execute(sql,args)).rows[0],
    all: async (sql,...args) => (await execute(sql,args)).rows,
    run: async (sql,...args) => {
      const result=await execute(sql,args);
      return {changes:result.rowCount};
    },
    transaction: async fn => {
      const connection=await pool.connect();
      try {
        await connection.query('BEGIN');
        const value=await context.run(connection,fn);
        await connection.query('COMMIT');
        return value;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    },
    close: async () => pool.end()
  };
}
