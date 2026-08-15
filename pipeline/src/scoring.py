"""Scoring masivo: cliente x ofertas elegibles x 4 canales.

Todo se pre-calcula y se guarda. El backend solo lee: preguntar "¿y si le
ofrezco el Básico en vez del Plus?" tiene que ser un SELECT, no una llamada a
un modelo, para que el copiloto responda al instante.

    valor_esperado = P(contacto | cliente, canal) x P(aceptación | oferta, canal)

Sobre el canal sugerido: en este dataset la contactabilidad no tiene señal
(AUC 0.500, tasa plana en 0.848) y la aceptación tampoco varía por canal. Así
que el canal NO se presenta como salida de un modelo. Se usa `canal_mas_usado`
—preferencia observada del cliente— y se etiqueta el origen en
`canal_origen`. Una regla honesta vale más que un modelo decorativo.
"""

import json

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import carga, dataset, elegibilidad
from .config import ARTIFACTS_DIR, CANALES, log

# Período que se está planificando. El historial va hasta 2026-06-10.
FECHA_SCORING = "2026-07-10"
TOP_N = 6
CHUNK_CLIENTES = 20_000
N_DRIVERS = 3

# Ofertas que habilitan internet hogar: son el puente para llegar a MT.
PUENTE_HOGAR = ["OF005", "OF006", "OF008", "OF009", "OF010"]
PUENTE_POSTPAGO = ["OF001", "OF002", "OF003", "OF004"]
MT_TIERS = ["OF020", "OF021", "OF022"]


# ------------------------------------------------------------------ ahorro


def _ahorro(df: pd.DataFrame) -> pd.Series:
    """Ahorro mensual real, en soles.

    Solo tiene lectura comercial cuando la oferta REEMPLAZA algo que el cliente
    ya paga. Un paquete adicional o un equipo se suman a la factura: ahí no hay
    ahorro y decir lo contrario sería engañar al cliente.
    """
    tipo = df["tipo_oferta"]
    ahorro = pd.Series(np.nan, index=df.index, dtype=float)
    # MT reemplaza todo el paquete del cliente.
    ahorro[tipo == "movistar_total"] = (
        df["gasto_actual_total"] - df["precio_mensual"]
    )
    # Un plan móvil reemplaza al plan móvil actual.
    ahorro[tipo == "plan_movil"] = df["_precio_plan_actual"] - df["precio_mensual"]
    # Un paquete hogar reemplaza al paquete hogar actual (0 si no tenía).
    ahorro[tipo == "plan_hogar"] = df["_precio_hogar_actual"] - df["precio_mensual"]
    return ahorro.round(2)


# ----------------------------------------------------------------- drivers


def _texto_driver(feature: str, valor, ctx: pd.Series) -> str:
    """Traduce una contribución de LightGBM a algo que un asesor pueda decir."""
    v = valor
    try:
        num = float(v)
    except (TypeError, ValueError):
        num = None

    if feature == "oferta_es_mt":
        return (
            "Es una oferta Movistar Total: en el historial convierten 2x mejor"
            if bool(v)
            else "No es una oferta Movistar Total, que es lo que mejor convierte"
        )
    if feature == "gb_ilimitado":
        return "Incluye datos ilimitados" if bool(v) else "Tiene un tope de datos"
    if feature == "cubre_presion_datos":
        return (
            "Le da más datos de los que hoy se le quedan cortos"
            if bool(v)
            else "No resuelve un problema de datos"
        )
    if feature == "es_usuario_app":
        return "Usa la app de Movistar" if bool(v) else "No usa la app"
    if feature == "tiene_internet_hogar":
        return (
            "Ya tiene internet en casa" if bool(v) else "No tiene internet en casa"
        )
    if feature == "tiene_hogar":
        return "Tiene servicios de hogar" if bool(v) else "No tiene servicios de hogar"
    if feature == "gasto_actual_total" and num is not None:
        return f"Hoy paga S/ {num:.2f} al mes sumando todos sus servicios"
    if feature == "ahorro_soles" and num is not None:
        return (
            f"Ahorraría S/ {num:.2f} al mes respecto de lo que paga hoy"
            if num > 0
            else f"Representa S/ {abs(num):.2f} más al mes"
        )
    if feature == "presion_datos" and num is not None:
        return (
            f"Consume {(num - 1) * 100:.0f}% más datos de los que incluye su plan"
            if num > 1
            else f"Usa el {num * 100:.0f}% de los datos de su plan"
        )
    if feature == "antiguedad_meses" and num is not None:
        return f"{num:.0f} meses de antigüedad"
    if feature == "meses_moroso" and num is not None:
        return f"{num:.0f} de 6 meses con mora mayor a 15 días"
    if feature == "dias_mora_prom" and num is not None:
        return f"Mora promedio de {num:.0f} días al mes"
    if feature == "n_reclamos" and num is not None:
        return f"{num:.0f} reclamos en los últimos 6 meses"
    if feature == "monto_facturado_prom" and num is not None:
        return f"Factura S/ {num:.2f} al mes en su plan móvil"
    if feature == "precio_mensual" and num is not None:
        return f"La oferta cuesta S/ {num:.2f} al mes"
    if feature == "ratio_precio_oferta_facturacion" and num is not None:
        return f"La oferta equivale a {num:.1f}x su facturación actual"
    if feature == "consumo_datos_gb_prom" and num is not None:
        return f"Consume {num:.1f} GB al mes"
    if feature == "es_upgrade":
        return "Es un upgrade sobre su plan actual" if bool(v) else "No es un upgrade"
    if feature == "gap_a_mt":
        return f"Ruta a Movistar Total: {v}"
    if feature == "salud_cliente":
        return f"Salud del cliente: {v}"
    if feature == "elegible_mt":
        return (
            "Cumple los requisitos de Movistar Total"
            if bool(v)
            else "Aún no cumple los requisitos de Movistar Total"
        )
    if feature == "tipo_cliente":
        return f"Cliente {v}"
    if feature == "canal":
        return f"Por canal {v}"
    if num is not None:
        return f"{feature.replace('_', ' ')}: {num:.2f}"
    return f"{feature.replace('_', ' ')}: {v}"


def _construir_drivers(
    df: pd.DataFrame, contrib: np.ndarray, features: list[str]
) -> list[list[dict]]:
    """Top contribuciones por fila. LightGBM las da nativamente con
    pred_contrib=True; no hace falta shap."""
    # La última columna de pred_contrib es el sesgo base, no una feature.
    aportes = contrib[:, :-1]
    top_idx = np.argsort(-np.abs(aportes), axis=1)[:, :N_DRIVERS]

    salida = []
    valores = {f: df[f].to_numpy() for f in features}
    for i in range(len(df)):
        fila = []
        for j in top_idx[i]:
            f = features[j]
            v = valores[f][i]
            if isinstance(v, float) and np.isnan(v):
                continue
            contribucion = float(aportes[i, j])
            fila.append(
                {
                    "feature": f,
                    "valor": (
                        bool(v) if isinstance(v, (bool, np.bool_))
                        else float(v) if isinstance(v, (int, float, np.number))
                        else str(v)
                    ),
                    "contribucion": round(contribucion, 4),
                    # El signo importa en pantalla: una contribución negativa
                    # bajo el título "por qué esta oferta" hace pensar al
                    # asesor que un factor en contra es un argumento a favor.
                    "a_favor": contribucion >= 0,
                    "texto": _texto_driver(f, v, df.iloc[i]),
                }
            )
        salida.append(fila)
    return salida


# ----------------------------------------------------------- política MT


def _avanza_a_mt(df: pd.DataFrame) -> pd.Series:
    """¿Esta oferta acerca al cliente a Movistar Total?

    True si la oferta es MT, o si es el producto puente que cierra el gap de
    este cliente: internet hogar para quien no lo tiene, plan móvil (postpago)
    para el prepago que ya tiene internet. Es la misma lógica que construye
    `ruta_mt`, aplicada como criterio de ranking.
    """
    gap = df["gap_a_mt"].astype(str)
    return (
        df["oferta_es_mt"].astype(bool)
        | (gap.isin(["producto_hogar", "internet_hogar"])
           & df["oferta_id"].isin(PUENTE_HOGAR))
        | ((gap == "migracion_postpago") & df["oferta_id"].isin(PUENTE_POSTPAGO))
    )


# ----------------------------------------------------------------- momento


def _momento_por_cliente(hist: pd.DataFrame, mediana_dias: int) -> pd.DataFrame:
    """El único momento defendible con estos datos.

    No hay resolución intra-mes (6 fechas en todo el historial) ni diferencia
    de contacto entre meses, así que no se inventa una franja. Lo que SÍ es
    señal real es un rechazo previo por `mal_momento`: ahí sí se puede decir
    algo, y se dice con el número observado.
    """
    mm = hist[hist["motivo_rechazo"] == "mal_momento"]
    ultimo = mm.sort_values("fecha").groupby("cliente_id")["fecha"].last()
    return pd.DataFrame(
        {
            "cliente_id": ultimo.index,
            "momento_sugerido": [
                f"Reprogramar. Rechazó por mal momento el {f:%Y-%m-%d}; "
                f"en el historial la mediana hasta el siguiente contacto "
                f"efectivo es de {mediana_dias} días."
                for f in ultimo
            ],
            "momento_origen": "rechazo_previo_mal_momento",
        }
    )


# ----------------------------------------------------------------- ruta MT


def _ruta_mt(
    cli_prep: pd.DataFrame, scores: pd.DataFrame, ofertas: pd.DataFrame
) -> pd.DataFrame:
    """Ruta de conversión a MT en dos pasos para quien todavía no es elegible.

    Esto es lo que amplía el mercado de 13,650 a 62,522: en vez de descartar al
    no elegible, se identifica el producto que le falta y se ordena la
    secuencia. MT no entra al ranking de un no elegible —ofrecerle algo que no
    puede contratar es el "riesgo de ofrecer productos poco adecuados"— pero sí
    entra como paso 2 de la ruta.
    """
    precio = dict(zip(ofertas["oferta_id"], ofertas["precio_mensual"]))
    nombre = dict(zip(ofertas["oferta_id"], ofertas["nombre_oferta"]))

    GAPS = {
        "producto_hogar": (
            PUENTE_HOGAR,
            "Tiene móvil postpago pero ningún servicio hogar. "
            "Con un paquete de internet hogar queda habilitado para Movistar Total.",
        ),
        "internet_hogar": (
            PUENTE_HOGAR,
            "Tiene móvil postpago y servicio hogar, pero sin internet "
            "(solo TV o fijo). Le falta internet hogar para ser elegible.",
        ),
        "migracion_postpago": (
            PUENTE_POSTPAGO,
            "Tiene internet hogar pero su línea móvil es prepago. "
            "Migrando a postpago queda habilitado para Movistar Total.",
        ),
    }

    cand = cli_prep[cli_prep["gap_a_mt"].isin(GAPS)][
        ["cliente_id", "gap_a_mt", "gasto_actual_total"]
    ].copy()
    if cand.empty:
        return pd.DataFrame()

    filas = []
    for gap, (puentes, desc) in GAPS.items():
        sub = cand[cand["gap_a_mt"] == gap]
        if sub.empty:
            continue
        # El puente es la oferta habilitante mejor rankeada para ese cliente.
        posibles = scores[scores["oferta_id"].isin(puentes)]
        mejor = (
            posibles.sort_values("valor_esperado", ascending=False)
            .drop_duplicates("cliente_id")
            .set_index("cliente_id")
        )
        j = sub.join(mejor[["oferta_id", "prob_aceptacion"]], on="cliente_id")
        j = j[j["oferta_id"].notna()]
        if j.empty:
            continue

        j["descripcion"] = desc
        j["oferta_puente_id"] = j["oferta_id"]
        j["oferta_puente_nombre"] = j["oferta_id"].map(nombre)
        j["oferta_puente_precio"] = j["oferta_id"].map(precio)
        j["prob_puente"] = j["prob_aceptacion"]

        # Gasto proyectado una vez cerrado el gap; contra eso se elige el tier
        # de MT que de verdad le ahorra.
        proyectado = j["gasto_actual_total"] + j["oferta_puente_precio"]
        tier, tier_precio = [], []
        for gp in proyectado:
            elegido = MT_TIERS[0]
            for t in MT_TIERS:
                if precio[t] <= gp:
                    elegido = t
            tier.append(elegido)
            tier_precio.append(precio[elegido])
        j["mt_destino_id"] = tier
        j["mt_destino_precio"] = tier_precio
        j["mt_destino_nombre"] = j["mt_destino_id"].map(nombre)
        j["ahorro_soles_proyectado"] = (proyectado - j["mt_destino_precio"]).round(2)
        filas.append(j)

    out = pd.concat(filas, ignore_index=True)
    return out[
        [
            "cliente_id", "gap_a_mt", "descripcion", "oferta_puente_id",
            "oferta_puente_nombre", "oferta_puente_precio", "prob_puente",
            "mt_destino_id", "mt_destino_nombre", "mt_destino_precio",
            "ahorro_soles_proyectado",
        ]
    ]


# -------------------------------------------------------------------- main


def main() -> None:
    cli = carga.cargar_clientes()
    ofertas = carga.cargar_ofertas()
    feats = pd.read_parquet(ARTIFACTS_DIR / "cliente_features.parquet")
    meta = json.loads((ARTIFACTS_DIR / "modelos_meta.json").read_text())
    niveles = meta["niveles"]
    fa, fb = meta["features_a"], meta["features_b"]

    modelo_a = lgb.Booster(model_file=str(ARTIFACTS_DIR / "modelo_aceptacion.txt"))
    modelo_b = lgb.Booster(model_file=str(ARTIFACTS_DIR / "modelo_contactabilidad.txt"))

    cli_prep = dataset.preparar_clientes(cli, ofertas, feats)
    of_prep = dataset.preparar_ofertas(ofertas)

    pares = elegibilidad.pares_elegibles(cli_prep, ofertas)
    log(f"pares elegibles: {len(pares):,} "
        f"({len(pares) / cli_prep['cliente_id'].nunique():.1f} ofertas por cliente)")

    ids = cli_prep["cliente_id"].to_numpy()
    trozos = [ids[i:i + CHUNK_CLIENTES] for i in range(0, len(ids), CHUNK_CLIENTES)]

    resultados = []
    for n_trozo, trozo in enumerate(trozos, 1):
        cli_c = cli_prep[cli_prep["cliente_id"].isin(trozo)]
        pares_c = pares[pares["cliente_id"].isin(trozo)]
        if pares_c.empty:
            continue

        por_canal = []
        for canal in CANALES:
            p = pares_c.assign(canal=canal, fecha=FECHA_SCORING)
            m = dataset.construir_matriz(p, cli_c, of_prep, niveles)
            m["prob_aceptacion"] = modelo_a.predict(dataset.matriz_X(m, fa))
            m["prob_contacto"] = modelo_b.predict(dataset.matriz_X(m, fb))
            m["valor_esperado"] = m["prob_aceptacion"] * m["prob_contacto"]
            por_canal.append(m)
        largo = pd.concat(por_canal, ignore_index=True)
        resultados.append(largo)
        log(f"  chunk {n_trozo}/{len(trozos)}: {len(largo):,} filas scoreadas")

    largo = pd.concat(resultados, ignore_index=True)

    # --- canal sugerido: preferencia observada, no predicción del modelo.
    pref = cli_prep.set_index("cliente_id")["canal_mas_usado"]
    largo["_canal_pref"] = largo["cliente_id"].map(pref)
    mejor_ve = (
        largo.sort_values("valor_esperado", ascending=False)
        .drop_duplicates("cliente_id")
        .set_index("cliente_id")["canal"]
    )
    canal_sug = largo["_canal_pref"].fillna(largo["cliente_id"].map(mejor_ve))
    largo["canal_origen"] = np.where(
        largo["_canal_pref"].notna(), "preferencia_observada", "modelo_valor_esperado"
    )
    largo["_canal_sugerido"] = canal_sug

    # --- ranking, sobre el canal sugerido
    completo = largo[largo["canal"] == largo["_canal_sugerido"]].copy()
    completo["ahorro_soles"] = _ahorro(completo)

    # POLÍTICA DE RANKING — el orden es política de negocio declarada, no solo
    # salida del modelo, y esto es deliberado:
    #
    # El modelo no distingue entre ofertas no-MT (empates de valor esperado a
    # 4 decimales son la norma) ni entre los tres tiers de MT (en el historial
    # convierten 0.696 / 0.702 / 0.693). Con AUC 0.587 y Brier 0.227,
    # diferencias de VE menores a 0.01 están por debajo de la resolución del
    # modelo: son ruido, no señal. Dentro de ese empate técnico decide la
    # estrategia del desafío, en este orden:
    #
    #   1. `avanza_a_mt`: la oferta es MT o es el puente que cierra el gap del
    #      cliente. Es el blindaje: la razón de ser del motor.
    #   2. No downgrades: un plan móvil más barato solo "gana" porque el
    #      desempate por ahorro lo premia, pero baja ARPU (KPI de la ficha) y
    #      no es una jugada proactiva de venta — es una palanca de retención.
    #   3. Valor esperado exacto, ahorro para el cliente, precio.
    completo["_ve_bucket"] = completo["valor_esperado"].round(2)
    completo["avanza_a_mt"] = _avanza_a_mt(completo)
    completo["_es_downgrade"] = (
        (completo["tipo_oferta"] == "plan_movil")
        & (completo["precio_mensual"] < completo["_precio_plan_actual"])
    )
    completo = completo.sort_values(
        [
            "cliente_id", "_ve_bucket", "avanza_a_mt", "_es_downgrade",
            "valor_esperado", "ahorro_soles", "precio_mensual",
        ],
        ascending=[True, False, False, True, False, False, True],
        na_position="last",
    )
    completo["rank"] = completo.groupby("cliente_id").cumcount() + 1

    # El top-N va a la UI; la ruta a MT necesita mirar TODAS las elegibles,
    # porque la oferta puente rara vez es la mejor rankeada.
    principal = completo[completo["rank"] <= TOP_N].reset_index(drop=True)
    log(f"top {TOP_N} por cliente: {len(principal):,} recomendaciones")

    # --- `por_canal` para el simulador, solo de los pares que sobreviven.
    # Vectorizado con pivot: un groupby.apply sobre ~900k grupos tardaría
    # minutos en Python puro.
    claves = set(zip(principal["cliente_id"], principal["oferta_id"]))
    sub = largo[
        pd.Series(list(zip(largo["cliente_id"], largo["oferta_id"])),
                  index=largo.index).isin(claves)
    ]
    ancho = sub.pivot_table(
        index=["cliente_id", "oferta_id"],
        columns="canal",
        values=["prob_contacto", "prob_aceptacion", "valor_esperado"],
        observed=True,
    )
    canales_presentes = [c for c in CANALES if ("prob_contacto", c) in ancho.columns]
    arrays = {
        c: (
            ancho[("prob_contacto", c)].to_numpy(),
            ancho[("prob_aceptacion", c)].to_numpy(),
            ancho[("valor_esperado", c)].to_numpy(),
        )
        for c in canales_presentes
    }
    por_canal_json = [
        json.dumps(
            [
                {
                    "canal": c,
                    "prob_contacto": round(float(arrays[c][0][i]), 4),
                    "prob_aceptacion": round(float(arrays[c][1][i]), 4),
                    "valor_esperado": round(float(arrays[c][2][i]), 4),
                }
                for c in canales_presentes
            ],
            ensure_ascii=False,
        )
        for i in range(len(ancho))
    ]
    mapa_canal = pd.Series(por_canal_json, index=ancho.index)
    principal["por_canal"] = pd.MultiIndex.from_arrays(
        [principal["cliente_id"], principal["oferta_id"]]
    ).map(mapa_canal)

    # --- drivers
    principal["ahorro_pct_real"] = (
        principal["ahorro_soles"] / principal["gasto_actual_total"].replace(0, np.nan)
    ).round(4)

    drivers = []
    for i in range(0, len(principal), 50_000):
        bloque = principal.iloc[i:i + 50_000]
        contrib = modelo_a.predict(dataset.matriz_X(bloque, fa), pred_contrib=True)
        drivers.extend(_construir_drivers(bloque.reset_index(drop=True), contrib, fa))
    principal["drivers"] = drivers

    # --- momento sugerido
    hist = carga.cargar_historial()
    rebate = json.loads((ARTIFACTS_DIR / "rebate_matrix.json").read_text())
    mm = next(m for m in rebate["motivos"] if m["motivo"] == "mal_momento")
    mediana = next(
        (a["dias_mediana_hasta_siguiente"] for a in mm["acciones"]
         if a["dias_mediana_hasta_siguiente"]), 31
    )
    momentos = _momento_por_cliente(hist, mediana)
    principal = principal.merge(momentos, on="cliente_id", how="left")

    # --- persistencia
    cols = [
        "cliente_id", "oferta_id", "rank", "prob_contacto", "prob_aceptacion",
        "valor_esperado", "ahorro_soles", "ahorro_pct_real", "avanza_a_mt",
        "drivers", "por_canal", "momento_sugerido", "momento_origen",
        "canal_origen",
    ]
    salida = principal[cols].copy()
    salida["canal_sugerido"] = principal["_canal_sugerido"]
    for c in ("prob_contacto", "prob_aceptacion", "valor_esperado"):
        salida[c] = salida[c].round(4)
    salida["drivers"] = salida["drivers"].map(lambda d: json.dumps(d, ensure_ascii=False))
    salida.to_parquet(ARTIFACTS_DIR / "nbo_scores.parquet", index=False)
    log(f"nbo_scores.parquet: {len(salida):,} filas")

    ruta = _ruta_mt(cli_prep, completo, ofertas)
    ruta.to_parquet(ARTIFACTS_DIR / "ruta_mt.parquet", index=False)
    log(f"ruta_mt.parquet: {len(ruta):,} clientes con ruta de 2 pasos")


if __name__ == "__main__":
    main()
