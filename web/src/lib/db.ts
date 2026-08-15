import { Pool, types } from "pg";

// Postgres devuelve NUMERIC e INT8 como string para no perder precisión.
// El contrato de datos exige `number`, y los rangos que manejamos (soles,
// probabilidades, conteos de 6 dígitos) caben de sobra en un double.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
types.setTypeParser(1082, (v) => v); // date: dejar el ISO YYYY-MM-DD tal cual

declare global {
  // eslint-disable-next-line no-var
  var __nboPool: Pool | undefined;
}

export const pool =
  global.__nboPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") global.__nboPool = pool;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Lee un artefacto JSON del pipeline (rebate_matrix, funnel, metrics). */
export async function getArtefacto<T>(
  nombre: string,
): Promise<{ payload: T; generado_en: string } | null> {
  return queryOne<{ payload: T; generado_en: string }>(
    "SELECT payload, generado_en FROM artefactos WHERE nombre = $1",
    [nombre],
  );
}
