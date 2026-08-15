"""Matriz de rebate — dos capas, deliberadamente separadas.

POR QUÉ NO SE USA `es_rebate`
------------------------------
El plan original era: "por cada motivo_rechazo, qué acción con es_rebate=True
convirtió mejor". No es calculable en estos datos. `es_rebate = True` aparece en
47,572 filas y TODAS son `rechazada`: la tasa de aceptación de esas filas es
exactamente 0.0000. Además se reparte al azar sobre ~30% de los rechazos, con
distribución de motivo idéntica. Es una bandera de ruido.

Calcular la matriz sobre `es_rebate` habría dado 0% en las 36 celdas y un
módulo que parece riguroso y no dice nada.

QUÉ SE MIDE EN SU LUGAR
-----------------------
Recuperación secuencial: tras un rechazo con motivo M, ¿aceptó el cliente el
SIGUIENTE ofrecimiento? Y sobre todo: ¿qué acción se tomó entre uno y otro?
Eso sí es medible, es lo que de verdad hace un asesor, y tiene señal.

LAS DOS CAPAS
-------------
1. Capa empírica: tasa de recuperación por (motivo, acción) con su `n`.
   `n < 30` se marca confianza baja. Ninguna tasa es inventada.
2. Capa de reglas de negocio: la *naturaleza* de cada motivo, que gobierna el
   SPEECH, no la tasa. Un `no_confia` no se responde con descuento aunque el
   número lo permita: empeora la objeción. Va declarada como criterio de
   negocio, no disfrazada de hallazgo.
"""

import json

import pandas as pd

from . import carga
from .config import ARTIFACTS_DIR, MOTIVOS_RECHAZO, log

N_MINIMO_CONFIANZA = 30

# Capa 2. Cada motivo pide una palanca distinta: no son seis variantes de
# "bajar el precio".
NATURALEZA = {
    "precio": (
        "precio",
        "Único motivo donde mover precio o bajar de tier tiene sentido.",
        {"bajar_precio", "pivot_a_mt", "precio_similar_otra_oferta"},
    ),
    "ya_tiene_similar": (
        "informacion",
        "Problema de información: hay que aclarar el diferencial, no rebajar.",
        {"pivot_a_mt", "precio_similar_otra_oferta", "subir_valor"},
    ),
    "no_necesita": (
        "encaje",
        "Problema de encaje: la oferta estaba mal elegida. Recomendar otra.",
        {"precio_similar_otra_oferta", "pivot_a_mt", "subir_valor"},
    ),
    "no_confia": (
        "confianza",
        "Problema de confianza: un descuento probablemente lo empeora. "
        "Construir respaldo y cambiar de canal a uno con contacto humano.",
        {"reintentar_otro_canal", "pivot_a_mt"},
    ),
    "mal_momento": (
        "timing",
        "No es rechazo del producto: es señal de timing. Reprogramar, "
        "no insistir con otra oferta.",
        {"reintentar_otro_canal", "reiterar_misma_oferta"},
    ),
    "otro": (
        "ninguna",
        "Sin acción específica: explorar la objeción antes de contraofertar.",
        {"pivot_a_mt", "precio_similar_otra_oferta", "reintentar_otro_canal"},
    ),
}

DESCRIPCION_ACCION = {
    "pivot_a_mt": "Pivotar a Movistar Total",
    "bajar_precio": "Ofrecer algo más barato (>10% menos)",
    "subir_valor": "Subir de tier / más valor (>10% más)",
    "precio_similar_otra_oferta": "Otra oferta de precio similar",
    "reiterar_misma_oferta": "Reiterar la misma oferta",
    "reintentar_otro_canal": "Reintentar la misma oferta por otro canal",
}


def _clasificar_accion(fila: pd.Series) -> str:
    """Qué se hizo entre el rechazo y el siguiente ofrecimiento."""
    if fila["sig_es_mt"] and not fila["oferta_es_mt"]:
        return "pivot_a_mt"
    if fila["sig_oferta_id"] == fila["oferta_id"]:
        return (
            "reintentar_otro_canal"
            if fila["sig_canal"] != fila["canal"]
            else "reiterar_misma_oferta"
        )
    p0, p1 = fila["precio_mensual"], fila["sig_precio"]
    if p0 and p1:
        if p1 < p0 * 0.9:
            return "bajar_precio"
        if p1 > p0 * 1.1:
            return "subir_valor"
    return "precio_similar_otra_oferta"


def construir() -> dict:
    hist = carga.cargar_historial()
    ofertas = carga.cargar_ofertas()
    precio = dict(zip(ofertas["oferta_id"], ofertas["precio_mensual"]))

    h = hist.sort_values(["cliente_id", "fecha"]).copy()
    h["precio_mensual"] = h["oferta_id"].map(precio)
    g = h.groupby("cliente_id")
    h["sig_oferta_id"] = g["oferta_id"].shift(-1)
    h["sig_canal"] = g["canal"].shift(-1)
    h["sig_resultado"] = g["resultado"].shift(-1)
    h["sig_es_mt"] = g["oferta_es_mt"].shift(-1)
    h["sig_fecha"] = g["fecha"].shift(-1)
    h["sig_precio"] = h["sig_oferta_id"].map(precio)

    # Solo rechazos que tuvieron un ofrecimiento posterior: si no lo hubo,
    # no hay recuperación que medir (y contarlo como fracaso sesgaría).
    rec = h[(h["resultado"] == "rechazada") & h["sig_oferta_id"].notna()].copy()
    rec["accion"] = rec.apply(_clasificar_accion, axis=1)
    rec["recuperado"] = (rec["sig_resultado"] == "aceptada").astype(int)
    rec["dias_hasta_siguiente"] = (rec["sig_fecha"] - rec["fecha"]).dt.days

    log(f"rebate: {len(rec):,} rechazos con ofrecimiento posterior")

    motivos = []
    for motivo in MOTIVOS_RECHAZO:
        sub = rec[rec["motivo_rechazo"] == motivo]
        if sub.empty:
            continue
        naturaleza, explicacion, coherentes = NATURALEZA[motivo]

        celdas = []
        for accion, grupo in sub.groupby("accion"):
            n = int(len(grupo))
            celdas.append(
                {
                    "accion": accion,
                    "descripcion": DESCRIPCION_ACCION.get(accion, accion),
                    "tasa_conversion": round(float(grupo["recuperado"].mean()), 4),
                    "n": n,
                    "confianza": "alta" if n >= N_MINIMO_CONFIANZA else "baja",
                    "dias_mediana_hasta_siguiente": (
                        None
                        if grupo["dias_hasta_siguiente"].isna().all()
                        else int(grupo["dias_hasta_siguiente"].median())
                    ),
                    "coherente_con_naturaleza": accion in coherentes,
                }
            )
        celdas.sort(key=lambda c: -c["tasa_conversion"])

        motivos.append(
            {
                "motivo": motivo,
                "naturaleza": naturaleza,
                "explicacion_naturaleza": explicacion,
                "tasa_base": round(float(sub["recuperado"].mean()), 4),
                "n_total": int(len(sub)),
                # Solo se recomiendan acciones coherentes con la naturaleza del
                # motivo. Las demás quedan visibles para auditoría.
                "acciones": [c for c in celdas if c["coherente_con_naturaleza"]],
                "acciones_descartadas": [
                    {**c, "razon_descarte": "incoherente con la naturaleza del motivo"}
                    for c in celdas
                    if not c["coherente_con_naturaleza"]
                ],
            }
        )

    return {
        "metodo": "recuperacion_secuencial",
        "nota_metodologica": (
            "No se usa `es_rebate`: en este dataset marca solo rechazos y su "
            "tasa de aceptación es 0.0000 en las 47,572 filas, además de "
            "repartirse al azar. Se mide en su lugar si el cliente aceptó el "
            "SIGUIENTE ofrecimiento y qué acción se tomó entre ambos."
        ),
        "n_minimo_confianza": N_MINIMO_CONFIANZA,
        "motivos": motivos,
    }


def main() -> None:
    matriz = construir()
    (ARTIFACTS_DIR / "rebate_matrix.json").write_text(
        json.dumps(matriz, ensure_ascii=False, indent=2)
    )
    for m in matriz["motivos"]:
        mejor = m["acciones"][0] if m["acciones"] else None
        log(
            f"  {m['motivo']:18s} base {m['tasa_base']:.3f} (n={m['n_total']:,}) "
            + (
                f"| mejor: {mejor['accion']} {mejor['tasa_conversion']:.3f} "
                f"(n={mejor['n']:,})"
                if mejor
                else "| sin acción coherente"
            )
        )


if __name__ == "__main__":
    main()
