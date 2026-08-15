"""Orquestador del pipeline completo. Un solo comando, de CSV a Postgres."""

from .config import log

PASOS = [
    ("seed de datos crudos", "seed"),
    ("feature engineering", "features"),
    ("modelos A (aceptación) y B (contactabilidad)", "modelos"),
    ("segmentación: k-means + capa de reglas", "segmentacion"),
    ("matriz de rebate empírica", "rebate"),
    ("scoring masivo y ruta a MT", "scoring"),
    ("funnel E2E, métricas y model card", "agregados"),
    ("carga de artefactos a Postgres", "seed_artefactos"),
]


def main() -> None:
    from importlib import import_module

    for i, (titulo, modulo) in enumerate(PASOS, 1):
        log(f"=== {i}/{len(PASOS)} {titulo} ===")
        import_module(f".{modulo}", package="src").main()

    log("pipeline completo")


if __name__ == "__main__":
    main()
