"""Carga los artefactos del pipeline a Postgres. Idempotente."""

import json

import pandas as pd

from .config import ARTIFACTS_DIR, log
from .db import aplicar_schema, connect, copy_df, upsert_artefacto


def main() -> None:
    with connect() as conn:
        # Autosuficiente: se puede correr suelto sobre una base ya existente
        # y aplica las migraciones pendientes antes de cargar.
        aplicar_schema(conn)

        feats = pd.read_parquet(ARTIFACTS_DIR / "cliente_features.parquet")
        copy_df(conn, feats, "cliente_features")

        personas = pd.read_parquet(ARTIFACTS_DIR / "personas.parquet")
        copy_df(conn, personas, "personas")

        scores = pd.read_parquet(ARTIFACTS_DIR / "nbo_scores.parquet")
        cols = [
            "cliente_id", "oferta_id", "rank", "canal_sugerido", "canal_origen",
            "momento_sugerido", "momento_origen", "prob_contacto",
            "prob_aceptacion", "valor_esperado", "ahorro_soles",
            "ahorro_pct_real", "avanza_a_mt", "drivers", "por_canal",
        ]
        copy_df(conn, scores[cols], "nbo_scores")

        ruta = pd.read_parquet(ARTIFACTS_DIR / "ruta_mt.parquet")
        copy_df(conn, ruta, "ruta_mt")

        for nombre in ("rebate_matrix", "funnel", "metrics"):
            payload = (ARTIFACTS_DIR / f"{nombre}.json").read_text()
            upsert_artefacto(conn, nombre, payload)

        # El model card viaja como artefacto para que la API pueda servirlo.
        upsert_artefacto(
            conn,
            "model_card",
            json.dumps(
                {"markdown": (ARTIFACTS_DIR / "model_card.md").read_text()},
                ensure_ascii=False,
            ),
        )

    log("artefactos cargados a Postgres")


if __name__ == "__main__":
    main()
