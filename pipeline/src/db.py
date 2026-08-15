"""Acceso a Postgres para el seed. Todo idempotente y re-ejecutable."""

import io
import os
from pathlib import Path

import pandas as pd
import psycopg

from .config import DATABASE_URL, log

MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR", "/db/migrations"))


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def aplicar_schema(conn: psycopg.Connection) -> None:
    """Aplica las migraciones. El SQL es idempotente (IF NOT EXISTS)."""
    if not MIGRATIONS.is_dir():
        log(f"migraciones no encontradas en {MIGRATIONS}; se asume schema aplicado")
        return
    for sql_file in sorted(MIGRATIONS.glob("*.sql")):
        log(f"aplicando {sql_file.name}")
        conn.execute(sql_file.read_text())
    conn.commit()


def copy_df(conn: psycopg.Connection, df: pd.DataFrame, tabla: str) -> None:
    """Reemplaza el contenido de `tabla` con `df` vía COPY. Idempotente:
    trunca y recarga, así re-sembrar nunca duplica."""
    cols = list(df.columns)
    buf = io.StringIO()
    df.to_csv(buf, index=False, header=False, na_rep="")
    buf.seek(0)

    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {tabla}")
        copy_sql = (
            f"COPY {tabla} ({', '.join(cols)}) "
            "FROM STDIN WITH (FORMAT csv, NULL '')"
        )
        with cur.copy(copy_sql) as copy:
            copy.write(buf.read())
    conn.commit()
    log(f"{tabla}: {len(df):,} filas")


def upsert_artefacto(conn: psycopg.Connection, nombre: str, payload: str) -> None:
    conn.execute(
        """
        INSERT INTO artefactos (nombre, payload, generado_en)
        VALUES (%s, %s::jsonb, now())
        ON CONFLICT (nombre) DO UPDATE
          SET payload = EXCLUDED.payload, generado_en = now()
        """,
        (nombre, payload),
    )
    conn.commit()
    log(f"artefacto '{nombre}' cargado")
