"""Modelo A (aceptación) y Modelo B (contactabilidad).

La descomposición central del proyecto:

    Valor esperado = P(contactar | canal, momento, cliente)
                   x P(aceptar  | contactado, oferta, canal)

Las filas con `resultado = 'pendiente'` NO son rechazos: coinciden exactamente
con `contactabilidad = 'no_contactado'` (45,494 = 45,494, verificado). Meterlas
al Modelo A como negativos enseñaría al modelo que "no contestó el teléfono"
es lo mismo que "no le interesó el producto".

QUÉ ENCONTRAMOS EN ESTOS DATOS (ver docs/hallazgos_datos.md)
------------------------------------------------------------
Los datos son sintéticos y el generador inyectó esencialmente UNA regla:
`oferta_es_mt` sube la aceptación de 0.341 a 0.697. Contactabilidad es una
moneda al aire constante (0.848 en todo canal, mes y perfil).

Por eso este módulo no persigue AUC: mide cuánta señal existe y cuánta
extraemos. Se comparan tres niveles —tasa base, regla MT sola, modelo
completo— y se reporta el margen. Un AUC de 0.58 contra un techo de ~0.57
es un resultado honesto; un 0.85 sería leakage.

Split con validación temporal: train <= 2026-03-31, valid = abril (early
stopping), test = mayo-junio. Nunca aleatorio: un split aleatorio pone al
mismo cliente en ambos lados e infla las métricas.
"""

import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, roc_auc_score

from . import carga, dataset
from .config import (
    ARTIFACTS_DIR,
    AUC_SOSPECHOSO,
    COLUMNAS_PROHIBIDAS,
    TEST_DESDE,
    TRAIN_HASTA,
    log,
)

VALID_DESDE = "2026-04-01"  # abril se reserva para early stopping

# Regularizado a propósito. Con features a nivel cliente y ~3 ofrecimientos por
# cliente, los defaults memorizan al cliente: subían el AUC de train a 0.74
# dejando el de test en 0.58. Como al asesor le mostramos la probabilidad en
# pantalla, una probabilidad mal calibrada es peor que no mostrarla.
PARAMS = {
    "objective": "binary",
    "metric": "auc",
    "verbosity": -1,
    "seed": 42,
    "learning_rate": 0.05,
    "num_leaves": 15,
    "min_data_in_leaf": 200,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 5.0,
}
N_ARBOLES = 500


def _auditar_leakage(X: pd.DataFrame, nombre: str) -> None:
    """Verificación explícita, no un comentario de buena fe."""
    intrusas = [c for c in X.columns if c in COLUMNAS_PROHIBIDAS]
    if intrusas:
        raise AssertionError(f"[{nombre}] LEAKAGE: {intrusas}")
    log(f"[{nombre}] auditoría de leakage OK — {X.shape[1]} features, "
        "ninguna post-resultado")


def _lift_por_decil(y: np.ndarray, p: np.ndarray) -> list[float]:
    """Cuánto convierte cada decil de score respecto a la media. Es la métrica
    que le importa al negocio: a quién llamo primero."""
    orden = np.argsort(-p)
    base = y.mean()
    if base == 0:
        return []
    trozos = np.array_split(orden, 10)
    return [round(float(y[t].mean() / base), 2) for t in trozos]


def _auc_baseline_mt(df_tr: pd.DataFrame, df_te: pd.DataFrame,
                     y_tr: pd.Series, y_te: pd.Series) -> float:
    """AUC de una regla de una sola variable: '¿la oferta es Movistar Total?',
    con la tasa estimada en train. Es el piso contra el que hay que comparar:
    mide cuánto aporta todo lo demás."""
    if "oferta_es_mt" not in df_tr.columns:
        return float("nan")
    tasas = y_tr.groupby(df_tr["oferta_es_mt"].astype(bool)).mean()
    score = df_te["oferta_es_mt"].astype(bool).map(tasas).fillna(y_tr.mean())
    return float(roc_auc_score(y_te, score))


def _calibrar(p_valid: np.ndarray, y_valid: np.ndarray) -> IsotonicRegression:
    """Calibración isotónica ajustada sobre el split de validación.

    Hace falta porque el early stopping mira AUC, que es una métrica de ORDEN y
    es ciega a la calibración: corta apenas el ranking deja de mejorar y deja
    las probabilidades pegadas a la tasa base. Medido en este dataset, el modelo
    predecía 0.495 para ofertas MT cuando la tasa real de aceptación es 0.697 —
    veinte puntos de diferencia en un número que el asesor le dice al cliente en
    voz alta.

    Isotónica y no reentrenar con otra métrica porque es MONÓTONA: no puede
    alterar el orden de las predicciones, así que el AUC y el ranking de la cola
    quedan intactos. Solo corrige los valores.

    Se ajusta sobre abril (validación), nunca sobre train —donde el modelo ya
    vio los datos y sus predicciones son optimistas— ni sobre test, que tiene
    que quedar limpio para la evaluación honesta.
    """
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(p_valid, y_valid)
    return iso


def _entrenar(
    df: pd.DataFrame, features: list[str], y: pd.Series, nombre: str
) -> tuple[lgb.Booster, IsotonicRegression, dict]:
    X = dataset.matriz_X(df, features)
    _auditar_leakage(X, nombre)

    fecha = pd.to_datetime(df["fecha"])
    en_train = fecha < VALID_DESDE
    en_valid = (fecha >= VALID_DESDE) & (fecha <= TRAIN_HASTA)
    en_test = fecha >= TEST_DESDE

    Xtr, ytr = X[en_train], y[en_train]
    Xva, yva = X[en_valid], y[en_valid]
    Xte, yte = X[en_test], y[en_test]
    log(f"[{nombre}] train {len(Xtr):,} (< {VALID_DESDE}) | "
        f"valid {len(Xva):,} (abril) | test {len(Xte):,} (>= {TEST_DESDE})")

    cats = [c for c in dataset.CATEGORICAS if c in features]
    booster = lgb.train(
        PARAMS,
        lgb.Dataset(Xtr, ytr, categorical_feature=cats),
        num_boost_round=N_ARBOLES,
        valid_sets=[lgb.Dataset(Xva, yva, categorical_feature=cats)],
        callbacks=[lgb.early_stopping(50, verbose=False)],
    )
    mejor = booster.best_iteration or N_ARBOLES

    p_tr = booster.predict(Xtr, num_iteration=mejor)
    p_va = booster.predict(Xva, num_iteration=mejor)
    p_te = booster.predict(Xte, num_iteration=mejor)

    calibrador = _calibrar(p_va, yva.to_numpy())
    p_te_cal = calibrador.predict(p_te)

    auc_tr = roc_auc_score(ytr, p_tr)
    auc_te = roc_auc_score(yte, p_te)
    # Debe dar idéntico al de arriba: la isotónica es monótona. Si difiere, el
    # calibrador rompió el orden y hay un bug.
    auc_te_cal = roc_auc_score(yte, p_te_cal)
    auc_mt = _auc_baseline_mt(df[en_train], df[en_test], ytr, yte)
    brier_sin = brier_score_loss(yte, p_te)
    brier = brier_score_loss(yte, p_te_cal)
    # Piso de comparación: el Brier de predecir siempre la tasa base. Si el
    # modelo no le gana, sus probabilidades no aportan información.
    base_te = float(yte.mean())
    brier_constante = base_te * (1 - base_te)
    # El lift se mide sobre las predicciones crudas: es una métrica de orden y
    # la calibración no lo mueve.
    deciles = _lift_por_decil(yte.to_numpy(), p_te)

    log(f"[{nombre}] árboles {mejor} | AUC train {auc_tr:.4f} | "
        f"AUC test {auc_te:.4f} | baseline solo-MT {auc_mt:.4f} | "
        f"Brier {brier_sin:.4f} -> {brier:.4f} calibrado "
        f"(constante {brier_constante:.4f}) | "
        f"lift decil 1 {deciles[0] if deciles else float('nan')}x")

    if auc_te > AUC_SOSPECHOSO:
        raise AssertionError(
            f"[{nombre}] AUC test {auc_te:.4f} > {AUC_SOSPECHOSO}. "
            "Con datos de campañas reales esto no pasa: asumir leakage y "
            "auditar las features antes de continuar."
        )

    metricas = {
        "auc_train": round(float(auc_tr), 4),
        "auc_test": round(float(auc_te), 4),
        # Prueba de que la calibración no tocó el ranking.
        "auc_test_calibrado": round(float(auc_te_cal), 4),
        "auc_baseline_solo_mt": None if np.isnan(auc_mt) else round(auc_mt, 4),
        "aporte_sobre_baseline": (
            None if np.isnan(auc_mt) else round(float(auc_te - auc_mt), 4)
        ),
        "brier_test": round(float(brier), 4),
        "brier_test_sin_calibrar": round(float(brier_sin), 4),
        "brier_predictor_constante": round(float(brier_constante), 4),
        "n_train": int(len(Xtr)),
        "n_valid": int(len(Xva)),
        "n_test": int(len(Xte)),
        "tasa_base_train": round(float(ytr.mean()), 4),
        "tasa_base_test": round(float(yte.mean()), 4),
        "lift_decil_superior": deciles[0] if deciles else None,
        "lift_por_decil": deciles,
        "n_arboles": int(mejor),
        "n_features": len(features),
        "split": {
            "train_hasta": "2026-03-31",
            "valid": "2026-04",
            "test_desde": TEST_DESDE,
        },
    }
    return booster, calibrador, metricas


def main() -> None:
    hist = carga.cargar_historial()
    cli = carga.cargar_clientes()
    ofertas = carga.cargar_ofertas()
    feats = pd.read_parquet(ARTIFACTS_DIR / "cliente_features.parquet")

    cli_prep = dataset.preparar_clientes(cli, ofertas, feats)
    of_prep = dataset.preparar_ofertas(ofertas)

    # El historial trae copiados los atributos del cliente al momento del
    # ofrecimiento. Se usan esos, no el snapshot actual: el snapshot es
    # posterior al evento y contamina.
    pares = hist[["cliente_id", "oferta_id", "canal", "fecha"]].copy()
    for c in dataset.PIT:
        pares[f"{c}_pit"] = hist[c]

    df = dataset.construir_matriz(pares, cli_prep, of_prep)
    niveles = dataset.extraer_niveles(df)
    df["resultado"] = hist["resultado"].to_numpy()
    df["contactabilidad"] = hist["contactabilidad"].to_numpy()

    # ---------------- Modelo B: contactabilidad (universo completo)
    y_b = (df["contactabilidad"] == "contactado").astype(int)
    modelo_b, _cal_b, met_b = _entrenar(
        df, dataset.FEATURES_B, y_b, "contactabilidad"
    )

    # ---------------- Modelo A: aceptación (solo contactados)
    contactados = df["contactabilidad"] == "contactado"
    df_a = df[contactados].reset_index(drop=True)
    log(f"[aceptacion] descartadas {int((~contactados).sum()):,} filas no "
        "contactadas (son 'pendiente', no rechazos)")
    y_a = (df_a["resultado"] == "aceptada").astype(int)
    modelo_a, cal_a, met_a = _entrenar(df_a, dataset.FEATURES_A, y_a, "aceptacion")

    # Un AUC de 0.50 no es un bug: significa que la variable no es predecible
    # con los datos disponibles. Se reporta, no se disimula.
    met_b["predecible"] = bool(met_b["auc_test"] >= 0.55)
    met_b["nota"] = (
        "Contactabilidad no es predecible en este dataset: la tasa es "
        "constante (~0.848) en todo canal, mes y perfil de cliente. El modelo "
        "queda en el pipeline porque es la arquitectura correcta para datos "
        "reales, pero NO se presenta como recomendador de canal."
        if met_b["auc_test"] < 0.55
        else "Contactabilidad muestra señal aprovechable."
    )

    modelo_a.save_model(str(ARTIFACTS_DIR / "modelo_aceptacion.txt"),
                        num_iteration=modelo_a.best_iteration)
    modelo_b.save_model(str(ARTIFACTS_DIR / "modelo_contactabilidad.txt"),
                        num_iteration=modelo_b.best_iteration)

    # Solo se persiste el calibrador de aceptación. El de contactabilidad no
    # hace falta: sin señal, el modelo se queda en la tasa base (predice
    # 0.843-0.853 contra un 0.848 real), o sea ya está calibrado por accidente.
    #
    # Se guarda como JSON y no como pickle a propósito: los puntos de quiebre se
    # leen a ojo, así que el mapeo "0.5068 -> 0.697" queda auditable en vez de
    # escondido en un binario atado a la versión de sklearn.
    (ARTIFACTS_DIR / "calibrador_aceptacion.json").write_text(
        json.dumps(
            {
                "metodo": "isotonic",
                "ajustado_sobre": "validacion (abril 2026)",
                "nota": (
                    "Mapea la salida cruda del modelo a la tasa de aceptación "
                    "observada. Es monótona: no altera el ranking, solo los "
                    "valores. Aplicar con np.interp(p, x, y)."
                ),
                "x": [round(float(v), 6) for v in cal_a.X_thresholds_],
                "y": [round(float(v), 6) for v in cal_a.y_thresholds_],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    importancias = sorted(
        zip(modelo_a.feature_name(), modelo_a.feature_importance("gain")),
        key=lambda t: -t[1],
    )[:15]

    (ARTIFACTS_DIR / "modelos_meta.json").write_text(
        json.dumps(
            {
                "features_a": dataset.FEATURES_A,
                "features_b": dataset.FEATURES_B,
                "niveles": niveles,
                "metricas": {"aceptacion": met_a, "contactabilidad": met_b},
                "columnas_prohibidas": COLUMNAS_PROHIBIDAS,
                "importancia_aceptacion": [
                    {"feature": f, "gain": round(float(g), 1)} for f, g in importancias
                ],
                "params": PARAMS,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    log("modelos y metadatos escritos")


if __name__ == "__main__":
    main()
