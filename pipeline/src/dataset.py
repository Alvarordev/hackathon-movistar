"""Construcción de la matriz de features.

Punto ÚNICO donde se calculan las features. Entrenamiento y scoring masivo
llaman a la misma función: si divergieran, el modelo vería en producción algo
distinto a lo que aprendió (train/serve skew) y las probabilidades que ve el
asesor serían mentira.
"""

import numpy as np
import pandas as pd

from .config import COLUMNAS_PROHIBIDAS, GB_ILIMITADO

# --------------------------------------------------------------- catálogos

CATEGORICAS = [
    "tipo_cliente", "edad_rango", "ubicacion_departamento", "canal_mas_usado",
    "salud_cliente", "gap_a_mt", "tipo_oferta", "segmento_objetivo",
    "cluster_hogar", "canal",
]

# Atributos del cliente. En entrenamiento, los cuatro que el historial copia
# al momento del ofrecimiento (tipo_cliente, antiguedad_meses, elegible_mt,
# es_movistar_total) se toman de la fila del historial, no del snapshot
# actual: el snapshot es del futuro respecto del evento.
F_CLIENTE = [
    "tipo_cliente", "antiguedad_meses", "elegible_mt", "es_movistar_total",
    "tiene_movil", "tiene_hogar", "tiene_internet_hogar",
    "monto_facturado_prom", "monto_facturado_prom_6m", "edad_rango",
    "ubicacion_departamento", "es_usuario_app", "consumo_datos_gb_prom",
    "consumo_voz_min_prom", "consumo_sms_prom", "uso_app_movistar_prom",
    "dias_mora_prom", "meses_moroso", "n_reclamos", "n_actividad_canal",
    "canal_mas_usado", "gasto_actual_total", "presion_datos", "salud_cliente",
    "gap_a_mt",
]

F_OFERTA = [
    "tipo_oferta", "segmento_objetivo", "oferta_es_mt", "precio_mensual",
    "gb_oferta", "gb_ilimitado", "cluster_hogar",
]

F_INTERACCION = [
    "ratio_precio_oferta_facturacion", "ratio_precio_gasto_total",
    "ahorro_soles", "es_upgrade", "delta_gb", "cubre_presion_datos",
]

# Sin día de la semana: el historial registra un único día por mes (el 10),
# así que `dia_semana` es perfectamente colineal con `mes` y no aporta nada.
F_CONTEXTO = ["canal", "mes"]

# Modelo A: aceptación. Todo.
FEATURES_A = F_CLIENTE + F_OFERTA + F_INTERACCION + F_CONTEXTO
# Modelo B: contactabilidad. Sin NADA de la oferta — contactar a alguien no
# depende de qué se le vaya a ofrecer.
FEATURES_B = F_CLIENTE + F_CONTEXTO

# Atributos que el historial copia al momento del evento.
PIT = ["tipo_cliente", "antiguedad_meses", "elegible_mt", "es_movistar_total"]


# ------------------------------------------------------------- preparación


def preparar_clientes(
    cli: pd.DataFrame, ofertas: pd.DataFrame, feats: pd.DataFrame
) -> pd.DataFrame:
    """Snapshot del cliente + features derivadas + precio/GB de lo que ya tiene."""
    precio = dict(zip(ofertas["oferta_id"], ofertas["precio_mensual"]))
    gb = dict(zip(ofertas["oferta_id"], ofertas["gb_incluidos"]))

    out = cli.merge(feats, on="cliente_id", how="left")
    out["_precio_plan_actual"] = out["plan_actual_id"].map(precio).fillna(0.0)
    out["_precio_hogar_actual"] = out["oferta_hogar_id"].map(precio).fillna(0.0)
    gb_plan = out["plan_actual_id"].map(gb)
    out["_gb_plan_actual"] = gb_plan.where(gb_plan != GB_ILIMITADO)
    return out


def preparar_ofertas(ofertas: pd.DataFrame) -> pd.DataFrame:
    out = ofertas.copy()
    # 9999 significa ilimitado, no 9999 GB. Como número crudo distorsiona
    # cualquier ratio; se marca con un flag y el valor va a NaN.
    out["gb_oferta"] = out["gb_incluidos"].where(out["gb_incluidos"] != GB_ILIMITADO)
    out["oferta_es_mt"] = out["es_movistar_total"]
    return out[
        [
            "oferta_id", "tipo_oferta", "segmento_objetivo", "oferta_es_mt",
            "precio_mensual", "gb_oferta", "gb_ilimitado", "cluster_hogar",
        ]
    ]


# ---------------------------------------------------------------- features


def construir_matriz(
    pares: pd.DataFrame,
    cli_prep: pd.DataFrame,
    of_prep: pd.DataFrame,
    niveles: dict[str, list] | None = None,
) -> pd.DataFrame:
    """`pares` necesita: cliente_id, oferta_id, canal, fecha.
    Opcionalmente columnas `<attr>_pit` para los atributos point-in-time."""
    df = pares.merge(cli_prep, on="cliente_id", how="left", suffixes=("", "_cli"))
    df = df.merge(of_prep, on="oferta_id", how="left")

    # Point-in-time gana sobre el snapshot actual cuando está disponible.
    for c in PIT:
        pit_col = f"{c}_pit"
        if pit_col in df.columns:
            df[c] = df[pit_col]

    # --- interacción cliente x oferta
    df["ratio_precio_oferta_facturacion"] = (
        df["precio_mensual"] / df["monto_facturado_prom"].replace(0, np.nan)
    )
    df["ratio_precio_gasto_total"] = (
        df["precio_mensual"] / df["gasto_actual_total"].replace(0, np.nan)
    )
    # Positivo = el cliente pagaría menos que hoy. Solo tiene lectura comercial
    # cuando la oferta reemplaza lo que ya tiene (MT o un paquete hogar mayor).
    df["ahorro_soles"] = (df["gasto_actual_total"] - df["precio_mensual"]).round(2)
    df["es_upgrade"] = df["precio_mensual"] > df["_precio_plan_actual"]
    df["delta_gb"] = df["gb_oferta"] - df["_gb_plan_actual"]
    # A quien se le queda corto el plan y la oferta le da más GB.
    df["cubre_presion_datos"] = (df["presion_datos"] > 1) & (df["delta_gb"] > 0)

    # --- contexto
    fecha = pd.to_datetime(df["fecha"])
    df["mes"] = fecha.dt.month

    for c in CATEGORICAS:
        if c not in df.columns:
            continue
        if niveles is not None:
            df[c] = pd.Categorical(df[c], categories=niveles[c])
        else:
            df[c] = df[c].astype("category")

    return df


def extraer_niveles(df: pd.DataFrame) -> dict[str, list]:
    """Niveles de cada categórica, en orden. LightGBM aprende sobre los
    códigos enteros de la categoría: si en scoring el orden cambiara, el
    modelo leería 'Digital' donde entrenó 'Tienda'. Se congelan aquí."""
    return {
        c: [str(v) for v in df[c].cat.categories]
        for c in CATEGORICAS
        if c in df.columns
    }


def matriz_X(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Extrae X y verifica que no se coló ninguna columna prohibida."""
    filtradas = [c for c in features if c in COLUMNAS_PROHIBIDAS]
    if filtradas:
        raise AssertionError(
            f"LEAKAGE: columnas post-resultado en las features: {filtradas}. "
            "Se conocen DESPUÉS del ofrecimiento; usarlas infla el AUC y el "
            "modelo no sirve en producción."
        )
    faltantes = [c for c in features if c not in df.columns]
    if faltantes:
        raise KeyError(f"faltan features en la matriz: {faltantes}")
    return df[features]
