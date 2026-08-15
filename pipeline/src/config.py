"""Configuración compartida del pipeline."""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
ARTIFACTS_DIR = Path(os.environ.get("ARTIFACTS_DIR", "/artifacts"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://nbo:nbo@db:5432/nbo")

CSV_CLIENTES = DATA_DIR / "dataset_clientes.csv"
CSV_OFERTAS = DATA_DIR / "catalogo_ofertas_entrega.csv"
CSV_HISTORIAL = DATA_DIR / "historial_campanias.csv"

# Split temporal — nunca aleatorio: un split aleatorio pone al mismo cliente
# en train y test e infla las métricas.
TRAIN_HASTA = "2026-04-30"
TEST_DESDE = "2026-05-01"

CANALES = ["Tienda", "Call In", "Call Out", "Digital"]

MOTIVOS_RECHAZO = [
    "precio",
    "ya_tiene_similar",
    "no_necesita",
    "no_confia",
    "mal_momento",
    "otro",
]

# Se conocen DESPUÉS del resultado. Prohibidas como features del Modelo A.
# Siguen siendo el corazón del módulo de trazabilidad E2E: se prohíben del
# entrenamiento, no del proyecto.
COLUMNAS_PROHIBIDAS = [
    "resultado",
    "motivo_rechazo",
    "es_rebate",
    "contactabilidad",
    "medio_probatorio",
]

# Si el AUC de test supera esto, asumir leakage y auditar antes de continuar.
AUC_SOSPECHOSO = 0.90

# El catálogo codifica "ilimitado" como 9999 GB. Tratarlo como numérico crudo
# distorsiona el modelo.
GB_ILIMITADO = 9999

MT_TIERS = ["OF020", "OF021", "OF022"]

# Umbrales de abstención: por debajo de esto no se hace upsell, se gestiona
# retención o cobranza. Responde al dolor declarado "riesgo de ofrecer
# productos poco adecuados".
ABSTENCION_MESES_MOROSO = 3
ABSTENCION_N_RECLAMOS = 4

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", flush=True)
