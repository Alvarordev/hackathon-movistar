"""Funnel E2E, métricas de impacto y model card.

El funnel responde al dolor declarado sin resolver en la ficha: "no existen
reportes unificados ni plataformas automáticas de escucha que permitan
identificar si un producto fue efectivamente ofrecido, ni trazar el
ofrecimiento de extremo a extremo".

Traza: ofrecimiento -> contactabilidad real -> medio probatorio -> resultado.
"""

import json

import pandas as pd

from . import carga
from .config import ARTIFACTS_DIR, CANALES, log

# Metas declaradas en la ficha del desafío.
META_HOGAR_PCT = 0.50
META_MOVIL_PCT = 0.10


def _etapas(h: pd.DataFrame) -> list[dict]:
    n_ofr = len(h)
    contactados = h[h["contactabilidad"] == "contactado"]
    con_prueba = contactados[contactados["medio_probatorio"].notna()]
    aceptados = contactados[contactados["resultado"] == "aceptada"]

    def pct(n, prev):
        return None if prev in (0, None) else round(n / prev, 4)

    return [
        {"etapa": "ofrecimientos", "n": n_ofr, "pct_del_anterior": None},
        {"etapa": "contactados", "n": len(contactados),
         "pct_del_anterior": pct(len(contactados), n_ofr)},
        {"etapa": "con_medio_probatorio", "n": len(con_prueba),
         "pct_del_anterior": pct(len(con_prueba), len(contactados))},
        {"etapa": "aceptados", "n": len(aceptados),
         "pct_del_anterior": pct(len(aceptados), len(con_prueba))},
    ]


def _bloque_funnel(h: pd.DataFrame, canal: str | None) -> dict:
    contactados = h[h["contactabilidad"] == "contactado"]
    aceptados = contactados[contactados["resultado"] == "aceptada"]
    ofr_mt = h[h["oferta_es_mt"]]
    acep_mt = aceptados[aceptados["oferta_es_mt"]]
    return {
        "canal": canal,
        "etapas": _etapas(h),
        "medios_probatorios": (
            h["medio_probatorio"].value_counts().to_dict()
        ),
        "rechazos_por_motivo": (
            contactados[contactados["resultado"] == "rechazada"]["motivo_rechazo"]
            .value_counts()
            .to_dict()
        ),
        "mt": {
            "ofrecimientos_mt": int(len(ofr_mt)),
            "aceptados_mt": int(len(acep_mt)),
            "pct_ofrecimientos_con_mt": round(len(ofr_mt) / len(h), 4) if len(h) else 0,
            "pct_venta_con_mt": (
                round(len(acep_mt) / len(aceptados), 4) if len(aceptados) else 0
            ),
        },
    }


def construir_funnel(hist: pd.DataFrame) -> dict:
    global_ = _bloque_funnel(hist, None)
    global_["por_canal"] = [
        _bloque_funnel(hist[hist["canal"] == c], c) for c in CANALES
    ]
    return global_


def construir_metrics(hist: pd.DataFrame, cli: pd.DataFrame) -> dict:
    meta = json.loads((ARTIFACTS_DIR / "modelos_meta.json").read_text())
    feats = pd.read_parquet(ARTIFACTS_DIR / "cliente_features.parquet")
    personas = pd.read_parquet(ARTIFACTS_DIR / "personas.parquet")
    scores = pd.read_parquet(ARTIFACTS_DIR / "nbo_scores.parquet")
    ofertas = carga.cargar_ofertas()
    es_mt = dict(zip(ofertas["oferta_id"], ofertas["es_movistar_total"]))
    tipo_of = dict(zip(ofertas["oferta_id"], ofertas["tipo_oferta"]))

    # --- cobertura perdida: elegibles a MT a los que nunca se les ofreció MT.
    elegibles = set(cli.loc[cli["elegible_mt"], "cliente_id"])
    ofertados_mt = set(hist.loc[hist["oferta_es_mt"], "cliente_id"])
    nunca = elegibles - ofertados_mt

    # --- participación de MT en la venta.
    # El denominador es TODA la venta del segmento (planes, upgrades, equipos y
    # paquetes), no solo los planes: la meta de la ficha habla de "la venta
    # hogar" y "la venta móvil". Acotarlo a `plan_movil` inflaba la
    # participación de MT hasta un absurdo 50% contra una meta de 10%.
    # MT cuenta en ambos denominadores porque es convergente: una venta de MT
    # es a la vez una venta hogar y una venta móvil.
    aceptados = hist[
        (hist["contactabilidad"] == "contactado") & (hist["resultado"] == "aceptada")
    ].merge(ofertas[["oferta_id", "segmento_objetivo"]], on="oferta_id", how="left")

    acep_mt = int(aceptados["oferta_es_mt"].sum())
    venta_hogar = int((aceptados["segmento_objetivo"] == "hogar").sum()) + acep_mt
    venta_movil = int((aceptados["segmento_objetivo"] == "movil").sum()) + acep_mt

    # --- proyección: si a cada cliente se le ofreciera su recomendación #1.
    # Es una proyección del modelo, no un resultado observado. Se etiqueta.
    top1 = scores[scores["rank"] == 1].copy()
    top1["es_mt"] = top1["oferta_id"].map(es_mt).fillna(False)
    top1["tipo"] = top1["oferta_id"].map(tipo_of)
    ventas_esp = top1["valor_esperado"]
    esp_mt = float(ventas_esp[top1["es_mt"]].sum())
    esp_hogar = float(ventas_esp[top1["tipo"] == "plan_hogar"].sum()) + esp_mt
    esp_movil = float(ventas_esp[top1["tipo"] == "plan_movil"].sum()) + esp_mt

    gap = feats["gap_a_mt"].value_counts().to_dict()
    a_un_producto = sum(
        gap.get(k, 0) for k in ("producto_hogar", "internet_hogar", "migracion_postpago")
    )

    return {
        "modelo_aceptacion": meta["metricas"]["aceptacion"],
        "modelo_contactabilidad": meta["metricas"]["contactabilidad"],
        "importancia_aceptacion": meta["importancia_aceptacion"],
        "cobertura_perdida_mt": {
            "clientes_elegibles": len(elegibles),
            "nunca_ofertados_mt": len(nunca),
            "pct": round(len(nunca) / len(elegibles), 4) if elegibles else 0,
        },
        "participacion_mt": {
            "definicion": (
                "Venta hogar = todas las ofertas aceptadas del segmento hogar "
                "(planes, upgrades y equipos) más las de Movistar Total. Venta "
                "móvil, lo mismo con el segmento móvil. MT cuenta en ambas por "
                "ser convergente: es a la vez una venta hogar y una venta móvil."
            ),
            "venta_hogar_actual_pct": round(acep_mt / venta_hogar, 4) if venta_hogar else 0,
            "meta_hogar_pct": META_HOGAR_PCT,
            "venta_movil_actual_pct": round(acep_mt / venta_movil, 4) if venta_movil else 0,
            "meta_movil_pct": META_MOVIL_PCT,
        },
        "proyeccion_modelo": {
            "metodo": (
                "Suma de valor esperado de la recomendación #1 de cada cliente. "
                "Es una proyección del modelo bajo el supuesto de que se ofrece "
                "a toda la planta, no un resultado medido."
            ),
            "ventas_esperadas_total": round(float(ventas_esp.sum()), 1),
            "ventas_esperadas_mt": round(esp_mt, 1),
            "proyectada_hogar_pct": round(esp_mt / esp_hogar, 4) if esp_hogar else 0,
            "proyectada_movil_pct": round(esp_mt / esp_movil, 4) if esp_movil else 0,
        },
        "mercado_ampliado_mt": {
            "ya_elegibles": int(gap.get("ninguno", 0)),
            "a_un_producto": int(a_un_producto),
            "total_alcanzable": int(gap.get("ninguno", 0) + a_un_producto),
            "multiplicador_vs_columna_cruda": (
                round((gap.get("ninguno", 0) + a_un_producto) / gap.get("ninguno", 1), 2)
            ),
            "desglose_gap": {k: int(v) for k, v in gap.items()},
        },
        "abstenciones": {
            "clientes_con_alerta": int(personas["alerta_retencion"].sum()),
            "pct": round(float(personas["alerta_retencion"].mean()), 4),
            "criterio": "meses_moroso >= 3 o n_reclamos >= 4",
        },
        "segmentacion": json.loads(
            (ARTIFACTS_DIR / "clusters_perfil.json").read_text()
        ),
    }


PLANTILLA_CARD = """# Model Card — Copiloto NBO

Generado por el pipeline. No editar a mano.

## Qué decide cada modelo

| | Modelo A — aceptación | Modelo B — contactabilidad |
|---|---|---|
| Universo | historial con `contactabilidad = 'contactado'` | historial completo |
| Target | `resultado = 'aceptada'` (1) vs `'rechazada'` (0) | `contactado` (1) vs `no_contactado` (0) |
| Descartado | `pendiente` — no son rechazos | nada |
| Features | {n_feat_a} (cliente + oferta + interacción + contexto) | {n_feat_b} (cliente + contexto, **sin oferta**) |

## Resultados

| Métrica | Modelo A | Modelo B |
|---|---|---|
| AUC test | **{auc_a}** | **{auc_b}** |
| AUC train | {auc_tr_a} | {auc_tr_b} |
| Gap train−test | {gap_a} | {gap_b} |
| Baseline "¿la oferta es MT?" | {base_a} | — |
| Aporte sobre el baseline | {aporte_a} | — |
| Brier (calibración) | {brier_a} | {brier_b} |
| Lift del decil superior | {lift_a}x | {lift_b}x |
| n train / valid / test | {ntr_a} / {nva_a} / {nte_a} | {ntr_b} / {nva_b} / {nte_b} |

Lift por decil (Modelo A): {deciles_a}

## Cómo leer estos números

El dataset es sintético y codifica esencialmente **una** regla: una oferta de
Movistar Total convierte 0.697 contra 0.341 del resto del portafolio. Todo lo
demás (canal, mes, edad, tipo de oferta, uso de app) es plano. Por eso una
regla de una sola variable ya alcanza AUC {base_a}, y el modelo completo con
{n_feat_a} features llega a {auc_a}: el margen de {aporte_a} es todo lo que
aportan las demás, y coincide con los efectos débiles de mora y antigüedad
medidos en el EDA.

**Un AUC de 0.85 en estos datos sería leakage, no mérito.** El pipeline aborta
si el AUC de test supera 0.90.

**Modelo B**: {nota_b}

## Decisiones de marcado

- **Split temporal**, nunca aleatorio: train < 2026-04-01, validación en abril
  (early stopping), test desde 2026-05-01. Un split aleatorio pondría al mismo
  cliente en ambos lados: cada cliente aparece ~3.2 veces en el historial.
- **Columnas prohibidas como features** (se conocen después del resultado):
  {prohibidas}. Hay un assert que aborta el entrenamiento si alguna aparece
  en X. Siguen usándose en el módulo de trazabilidad E2E, que es otro uso.
- **Atributos point-in-time**: `tipo_cliente`, `antiguedad_meses`,
  `elegible_mt` y `es_movistar_total` se leen de la fila del historial (estado
  al momento del ofrecimiento), no del snapshot actual del cliente, que es
  posterior al evento.
- **Regularización deliberada**: con los defaults de LightGBM el gap train−test
  era 0.16; el modelo memorizaba clientes. Como la probabilidad se le muestra
  al asesor en pantalla, una mal calibrada es peor que ninguna.
- **Sin `shap`**: las contribuciones por feature salen nativas de LightGBM con
  `pred_contrib=True`.
- **Sin tuning de hiperparámetros, sin MLflow/Optuna/Airflow.**

## Features más influyentes (Modelo A, por ganancia)

{importancias}

## Limitaciones

1. Las features de comportamiento del cliente son un snapshot único: no hay
   histórico mensual por cliente, así que no se puede reconstruir su estado
   exacto en cada ofrecimiento pasado.
2. La contactabilidad no es modelable con estos datos; el canal sugerido es
   una regla sobre preferencia observada y está etiquetado como tal.
3. No hay resolución temporal intra-mes (6 fechas en todo el historial), así
   que no se recomienda día ni franja horaria.
4. Los datos son sintéticos: estas métricas describen la capacidad de recuperar
   las reglas del generador, no el desempeño esperado sobre clientes reales.
"""


def construir_model_card(metrics: dict) -> str:
    a = metrics["modelo_aceptacion"]
    b = metrics["modelo_contactabilidad"]
    prohibidas = json.loads((ARTIFACTS_DIR / "modelos_meta.json").read_text())[
        "columnas_prohibidas"
    ]
    imp = "\n".join(
        f"| `{i['feature']}` | {i['gain']:,.0f} |"
        for i in metrics["importancia_aceptacion"]
    )
    return PLANTILLA_CARD.format(
        n_feat_a=a["n_features"], n_feat_b=b["n_features"],
        auc_a=a["auc_test"], auc_b=b["auc_test"],
        auc_tr_a=a["auc_train"], auc_tr_b=b["auc_train"],
        gap_a=round(a["auc_train"] - a["auc_test"], 4),
        gap_b=round(b["auc_train"] - b["auc_test"], 4),
        base_a=a["auc_baseline_solo_mt"], aporte_a=a["aporte_sobre_baseline"],
        brier_a=a["brier_test"], brier_b=b["brier_test"],
        lift_a=a["lift_decil_superior"], lift_b=b["lift_decil_superior"],
        ntr_a=f"{a['n_train']:,}", nva_a=f"{a['n_valid']:,}", nte_a=f"{a['n_test']:,}",
        ntr_b=f"{b['n_train']:,}", nva_b=f"{b['n_valid']:,}", nte_b=f"{b['n_test']:,}",
        deciles_a=", ".join(f"{d}x" for d in a["lift_por_decil"]),
        nota_b=b["nota"],
        prohibidas=", ".join(f"`{c}`" for c in prohibidas),
        importancias="| Feature | Ganancia |\n|---|---|\n" + imp,
    )


def main() -> None:
    hist = carga.cargar_historial()
    cli = carga.cargar_clientes()

    funnel = construir_funnel(hist)
    (ARTIFACTS_DIR / "funnel.json").write_text(
        json.dumps(funnel, ensure_ascii=False, indent=2)
    )
    log(f"funnel: {funnel['etapas'][0]['n']:,} ofrecimientos -> "
        f"{funnel['etapas'][-1]['n']:,} aceptados "
        f"({funnel['mt']['pct_venta_con_mt']:.1%} de la venta es MT)")

    metrics = construir_metrics(hist, cli)
    (ARTIFACTS_DIR / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2)
    )
    cob = metrics["cobertura_perdida_mt"]
    log(f"cobertura perdida MT: {cob['nunca_ofertados_mt']:,} de "
        f"{cob['clientes_elegibles']:,} elegibles nunca recibieron MT ({cob['pct']:.1%})")
    merc = metrics["mercado_ampliado_mt"]
    log(f"mercado MT: {merc['ya_elegibles']:,} -> {merc['total_alcanzable']:,} "
        f"({merc['multiplicador_vs_columna_cruda']}x)")

    (ARTIFACTS_DIR / "model_card.md").write_text(construir_model_card(metrics))
    log("model_card.md escrito")


if __name__ == "__main__":
    main()
