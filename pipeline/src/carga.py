"""Carga de los CSV crudos con los tipos correctos.

Punto único donde se interpretan las trampas del dataset, para que ni el seed
ni el modelado las vuelvan a cometer:

  - `tipo_cliente` nulo = cliente sin línea móvil (nulo legítimo, no faltante)
  - `gb_incluidos = 9999` = ilimitado, no 9999 GB
  - `es_movistar_total` (del cliente) != `oferta_es_mt` (de la oferta presentada)
  - `tiene_hogar` != `tiene_internet_hogar` (solo TV no habilita MT)
"""

import pandas as pd

from .config import (
    CSV_CLIENTES,
    CSV_HISTORIAL,
    CSV_OFERTAS,
    GB_ILIMITADO,
    log,
)

BOOLS_CLIENTES = [
    "tiene_movil",
    "tiene_hogar",
    "tiene_internet_hogar",
    "es_movistar_total",
    "elegible_mt",
    "es_usuario_app",
]


def cargar_ofertas() -> pd.DataFrame:
    df = pd.read_csv(CSV_OFERTAS)
    df["es_movistar_total"] = df["es_movistar_total"].astype(bool)
    df["gb_ilimitado"] = df["gb_incluidos"] == GB_ILIMITADO

    # El texto comercial del catálogo trae el centinela embebido:
    # "Movistar Total Max - 9999GB - S/ 229.9". Ese campo se le muestra al
    # asesor y termina en lo que le dice al cliente, así que no basta con
    # tratar el 9999 como nulo en las features: hay que limpiarlo también acá.
    df["descripcion_corta"] = df["descripcion_corta"].str.replace(
        f"{GB_ILIMITADO}GB", "GB ilimitados", regex=False
    )

    log(f"ofertas: {len(df)} filas, {df['es_movistar_total'].sum()} son MT, "
        f"{int(df['gb_ilimitado'].sum())} con GB ilimitados")
    return df


def cargar_clientes() -> pd.DataFrame:
    df = pd.read_csv(CSV_CLIENTES)
    for c in BOOLS_CLIENTES:
        df[c] = df[c].astype(bool)
    log(
        f"clientes: {len(df):,} filas | elegibles MT: {df['elegible_mt'].sum():,} "
        f"| ya MT: {df['es_movistar_total'].sum():,} "
        f"| sin línea móvil: {df['tipo_cliente'].isna().sum():,}"
    )
    return df


def cargar_historial() -> pd.DataFrame:
    df = pd.read_csv(CSV_HISTORIAL, parse_dates=["fecha"])
    for c in ["es_rebate", "elegible_mt", "es_movistar_total", "oferta_es_mt"]:
        df[c] = df[c].astype(bool)
    log(
        f"historial: {len(df):,} filas | "
        f"{(df['resultado'] == 'aceptada').sum():,} aceptadas / "
        f"{(df['resultado'] == 'rechazada').sum():,} rechazadas / "
        f"{(df['resultado'] == 'pendiente').sum():,} pendientes"
    )
    return df


def gb_efectivos(gb: pd.Series) -> pd.Series:
    """GB utilizables para ratios. Ilimitado -> NaN, no 9999."""
    return gb.where(gb != GB_ILIMITADO)
