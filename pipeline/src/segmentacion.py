"""Segmentación de clientes: K-means + capa de reglas interpretable.

La ficha pide clustering explícitamente. Pero un `cluster_id = 3` no le sirve
de nada a un asesor con el cliente en línea. Por eso van las dos capas:

  1. K-means sobre comportamiento decide QUIÉN va con QUIÉN (no supervisado,
     k elegido por silhouette).
  2. Una capa de reglas le pone nombre y descripción a cada cluster leyendo su
     perfil real. El cluster da el segmento; la regla lo explica.

Los nombres se asignan de forma determinista y sin repetir: cada regla se queda
con el cluster que más la cumple, en orden de prioridad.
"""

import json

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from . import carga
from .config import (
    ABSTENCION_MESES_MOROSO,
    ABSTENCION_N_RECLAMOS,
    ARTIFACTS_DIR,
    log,
)

VARS_COMPORTAMIENTO = [
    "consumo_datos_gb_prom",
    "consumo_voz_min_prom",
    "consumo_sms_prom",
    "uso_app_movistar_prom",
    "monto_facturado_prom_6m",
    "dias_mora_prom",
    "n_reclamos",
    "n_actividad_canal",
    "antiguedad_meses",
]

K_MIN, K_MAX = 5, 8
MUESTRA_SILHOUETTE = 10_000
SEED = 42


def _elegir_k(X: np.ndarray) -> tuple[int, dict[int, float]]:
    """Silhouette sobre una muestra: calcularlo con 100k puntos es O(n^2)."""
    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(X), size=min(MUESTRA_SILHOUETTE, len(X)), replace=False)
    puntajes = {}
    for k in range(K_MIN, K_MAX + 1):
        km = KMeans(n_clusters=k, random_state=SEED, n_init=10).fit(X)
        puntajes[k] = float(silhouette_score(X[idx], km.labels_[idx]))
        log(f"k={k} silhouette={puntajes[k]:.4f}")
    mejor = max(puntajes, key=puntajes.get)
    log(f"k elegido: {mejor}")
    return mejor, puntajes


# (nombre, criterio sobre el perfil del cluster, plantilla de descripción)
REGLAS = [
    (
        "En Riesgo de Cobranza",
        lambda p: p["z_mora"],
        "Mora promedio de {dias_mora_prom:.0f} días y {n_reclamos:.1f} reclamos. "
        "No es cliente de upsell: corresponde gestión de cobranza.",
    ),
    (
        "MT Consolidado",
        lambda p: p["pct_mt"],
        "{pct_mt:.0%} ya tiene Movistar Total. Facturación media S/ {monto_facturado_prom_6m:.0f}. "
        "Blindado: el foco es retención y upgrade de tier.",
    ),
    (
        "Convergente Dormido",
        lambda p: p["pct_convergente"],
        "{pct_convergente:.0%} tiene móvil y hogar por separado sin convergencia. "
        "Paga S/ {gasto_actual_total:.0f} al mes en total: es el candidato natural a MT.",
    ),
    (
        "Digital Autónomo",
        lambda p: p["z_app"] + p["z_datos"],
        "{pct_app:.0%} usa la app, {uso_app_movistar_prom:.1f} sesiones al mes y "
        "{consumo_datos_gb_prom:.0f} GB. Se le llega mejor por canal digital.",
    ),
    (
        "Alto Valor",
        lambda p: p["z_gasto"],
        "Factura S/ {monto_facturado_prom_6m:.0f} al mes, el más alto de la planta. "
        "Prioridad de retención por ARPU.",
    ),
    (
        "Veterano Estable",
        lambda p: p["z_antig"],
        "{antiguedad_meses:.0f} meses de antigüedad y consumo estable. "
        "Baja fricción, buena base para cross-sell.",
    ),
    (
        "Prepago Ocasional",
        lambda p: p["pct_prepago"],
        "{pct_prepago:.0%} es prepago, {consumo_datos_gb_prom:.0f} GB de consumo. "
        "El primer paso es migrar a postpago.",
    ),
    (
        "Consumo Básico",
        lambda p: -p["z_gasto"],
        "Facturación S/ {monto_facturado_prom_6m:.0f} y {consumo_datos_gb_prom:.0f} GB. "
        "Sensible a precio: conviene entrar por el tier más bajo.",
    ),
]


def _perfilar(cli: pd.DataFrame, labels: np.ndarray) -> pd.DataFrame:
    d = cli.copy()
    d["cluster_id"] = labels
    d["_convergente"] = d["tiene_movil"] & d["tiene_hogar"] & ~d["es_movistar_total"]

    perfil = d.groupby("cluster_id").agg(
        n=("cliente_id", "size"),
        consumo_datos_gb_prom=("consumo_datos_gb_prom", "mean"),
        uso_app_movistar_prom=("uso_app_movistar_prom", "mean"),
        monto_facturado_prom_6m=("monto_facturado_prom_6m", "mean"),
        gasto_actual_total=("gasto_actual_total", "mean"),
        dias_mora_prom=("dias_mora_prom", "mean"),
        n_reclamos=("n_reclamos", "mean"),
        antiguedad_meses=("antiguedad_meses", "mean"),
        pct_mt=("es_movistar_total", "mean"),
        pct_convergente=("_convergente", "mean"),
        pct_app=("es_usuario_app", "mean"),
        pct_prepago=("tipo_cliente", lambda s: (s == "prepago").mean()),
    )

    # z respecto a la planta, para que las reglas comparen entre clusters.
    for col, z in [
        ("dias_mora_prom", "z_mora"),
        ("consumo_datos_gb_prom", "z_datos"),
        ("uso_app_movistar_prom", "z_app"),
        ("monto_facturado_prom_6m", "z_gasto"),
        ("antiguedad_meses", "z_antig"),
    ]:
        s = perfil[col]
        perfil[z] = (s - s.mean()) / (s.std() or 1.0)
    return perfil


def _nombrar(perfil: pd.DataFrame) -> dict[int, tuple[str, str]]:
    """Asignación greedy: cada regla, en orden de prioridad, se queda con el
    cluster que más la cumple entre los que siguen libres."""
    libres = set(perfil.index)
    nombres: dict[int, tuple[str, str]] = {}
    for nombre, criterio, plantilla in REGLAS:
        if not libres:
            break
        cand = max(libres, key=lambda c: criterio(perfil.loc[c]))
        p = perfil.loc[cand]
        nombres[cand] = (nombre, plantilla.format(**p.to_dict()))
        libres.discard(cand)
    return nombres


def main() -> None:
    cli = carga.cargar_clientes()
    feats = pd.read_parquet(ARTIFACTS_DIR / "cliente_features.parquet")
    cli = cli.merge(feats, on="cliente_id", how="left")

    X = StandardScaler().fit_transform(cli[VARS_COMPORTAMIENTO].fillna(0.0))
    k, puntajes = _elegir_k(X)
    labels = KMeans(n_clusters=k, random_state=SEED, n_init=10).fit_predict(X)

    perfil = _perfilar(cli, labels)
    nombres = _nombrar(perfil)

    out = pd.DataFrame(
        {
            "cliente_id": cli["cliente_id"],
            "cluster_id": labels,
        }
    )
    out["persona"] = out["cluster_id"].map(lambda c: nombres[c][0])
    out["persona_desc"] = out["cluster_id"].map(lambda c: nombres[c][1])

    # Abstención: no es un upsell, es una alerta. Responde al dolor declarado
    # "riesgo de ofrecer productos poco adecuados".
    critico_mora = cli["meses_moroso"] >= ABSTENCION_MESES_MOROSO
    critico_rec = cli["n_reclamos"] >= ABSTENCION_N_RECLAMOS
    out["alerta_retencion"] = (critico_mora | critico_rec).to_numpy()
    out["motivo_alerta"] = np.where(
        critico_mora & critico_rec,
        cli["meses_moroso"].astype(str)
        + " de 6 meses con mora mayor a 15 días y "
        + cli["n_reclamos"].astype(str)
        + " reclamos. Corresponde retención y cobranza, no venta.",
        np.where(
            critico_mora,
            cli["meses_moroso"].astype(str)
            + " de 6 meses con mora mayor a 15 días. "
            "Corresponde gestión de cobranza, no venta.",
            np.where(
                critico_rec,
                cli["n_reclamos"].astype(str)
                + " reclamos en 6 meses. Resolver la fricción antes de ofrecer.",
                None,
            ),
        ),
    )

    out.to_parquet(ARTIFACTS_DIR / "personas.parquet", index=False)
    (ARTIFACTS_DIR / "clusters_perfil.json").write_text(
        json.dumps(
            {
                "k": k,
                "silhouette_por_k": puntajes,
                "variables": VARS_COMPORTAMIENTO,
                "clusters": [
                    {
                        "cluster_id": int(c),
                        "nombre": nombres[c][0],
                        "descripcion": nombres[c][1],
                        **{
                            k2: round(float(v), 4)
                            for k2, v in perfil.loc[c].to_dict().items()
                        },
                    }
                    for c in perfil.index
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    log(f"personas: {out['alerta_retencion'].sum():,} clientes con alerta de retención")
    for c in perfil.index:
        log(f"  cluster {c} ({int(perfil.loc[c, 'n']):,}): {nombres[c][0]}")


if __name__ == "__main__":
    main()
