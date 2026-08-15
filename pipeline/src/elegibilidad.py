"""Qué ofertas se le pueden presentar a cada cliente.

El catálogo tiene 22 ofertas: esto no es un problema de recomendación con
sparsity, es un ranking sobre 22 candidatos. Se filtra primero por
elegibilidad de negocio y después se ordena por valor esperado. Nada de
factorización matricial ni embeddings.

El motor es general: aplica a las 22 ofertas del portafolio. Movistar Total
es un caso más, con sus propias reglas, no un motor aparte.

Todo vectorizado sobre el cross join (100k x 22 = 2.2M filas).
"""

import pandas as pd

# Un upgrade solo tiene sentido si el plan actual está por debajo del destino.
UPGRADE_REQUIERE_PLAN_EN = {
    "OF011": {"OF001"},              # Upgrade a Plan Plus
    "OF012": {"OF001", "OF002"},     # Upgrade a Plan Max
}

MT_TIER_ORDEN = {"OF020": 1, "OF021": 2, "OF022": 3}


def cross_join(clientes: pd.DataFrame, ofertas: pd.DataFrame) -> pd.DataFrame:
    cols_cli = [
        "cliente_id", "tiene_movil", "tiene_hogar", "tiene_internet_hogar",
        "es_movistar_total", "elegible_mt", "plan_actual_id", "oferta_hogar_id",
        "_precio_plan_actual", "_precio_hogar_actual",
    ]
    return clientes[cols_cli].merge(
        ofertas[
            ["oferta_id", "tipo_oferta", "segmento_objetivo", "precio_mensual"]
        ],
        how="cross",
    )


def marcar_elegibles(pares: pd.DataFrame) -> pd.Series:
    """Máscara booleana sobre el cross join cliente x oferta."""
    tipo = pares["tipo_oferta"]
    seg = pares["segmento_objetivo"]
    oid = pares["oferta_id"]
    precio = pares["precio_mensual"]

    movil = pares["tiene_movil"]
    inet = pares["tiene_internet_hogar"]
    hogar = pares["tiene_hogar"]
    es_mt = pares["es_movistar_total"]
    elegible_mt = pares["elegible_mt"]
    plan_actual = pares["plan_actual_id"]

    ok = pd.Series(False, index=pares.index)

    # --- plan móvil: solo con línea móvil. A un cliente que ya es MT no se le
    # ofrece un plan móvil suelto: sería romperle el bundle.
    ok |= (tipo == "plan_movil") & movil & ~es_mt

    # --- plan hogar. Sin hogar: cualquiera. Con hogar: solo un paquete de
    # mayor valor que el actual (si no, es un downgrade disfrazado).
    ok |= (tipo == "plan_hogar") & ~es_mt & ~hogar
    ok |= (
        (tipo == "plan_hogar")
        & ~es_mt
        & hogar
        & (precio > pares["_precio_hogar_actual"].fillna(0.0))
    )

    # --- upgrades móviles: requieren estar por debajo del tier destino.
    for up_id, planes_base in UPGRADE_REQUIERE_PLAN_EN.items():
        ok |= (oid == up_id) & movil & ~es_mt & plan_actual.isin(planes_base)
    ok |= (oid == "OF013") & inet          # Upgrade Velocidad Hogar

    # --- equipos
    ok |= (tipo == "equipo") & (seg == "movil") & movil
    ok |= (oid == "OF016") & inet          # Router WiFi 6

    # --- paquetes adicionales
    ok |= (tipo == "paquete_adicional") & (seg == "ambos")
    ok |= (oid == "OF019") & movil         # Roaming

    # --- Movistar Total
    tier_oferta = oid.map(MT_TIER_ORDEN).fillna(0)
    tier_actual = plan_actual.map(MT_TIER_ORDEN).fillna(0)
    # Ya es MT: solo tiene sentido subir de tier.
    ok |= (tipo == "movistar_total") & es_mt & (tier_oferta > tier_actual)
    # Elegible y aún no lo tiene: los 3 tiers entran al ranking.
    ok |= (tipo == "movistar_total") & ~es_mt & elegible_mt
    # Si no es elegible, MT no entra al ranking: entra por `ruta_mt`, que
    # primero cierra el gap. Ofrecer MT a quien no lo puede contratar es
    # exactamente el "riesgo de ofrecer productos poco adecuados" de la ficha.

    # Nunca reofrecer lo que ya tiene.
    ok &= oid != plan_actual
    ok &= (oid != pares["oferta_hogar_id"]) | pares["oferta_hogar_id"].isna()

    return ok


def pares_elegibles(clientes: pd.DataFrame, ofertas: pd.DataFrame) -> pd.DataFrame:
    pares = cross_join(clientes, ofertas)
    return pares.loc[marcar_elegibles(pares), ["cliente_id", "oferta_id"]].reset_index(
        drop=True
    )
