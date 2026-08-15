"""Feature engineering a nivel cliente.

Hallazgo que justifica `gasto_actual_total` (verificado sobre el dataset):

    solo móvil   (n=54,758)  monto_facturado_prom ≈ precio(plan_actual)      Δ media  0.00
    móvil+hogar  (n=38,048)  monto_facturado_prom ≈ precio(plan_actual)      Δ media -109.15
    cliente MT   (n= 7,194)  monto_facturado_prom ≈ precio(tier MT)          Δ media  0.34

Es decir: `monto_facturado_prom` refleja SOLO el plan móvil. Para un cliente
convergente, lo que realmente paga al mes es ~S/109 más de lo que muestra ese
campo. Un asesor que mira la facturación subestima el ahorro de MT por ese
margen. Por eso `gasto_actual_total` no es cosmética: es el número con el que
se arma el speech.

Para clientes que YA son MT, `plan_actual_id` es el propio tier MT, así que
sumar `oferta_hogar_id` duplicaría el cargo.
"""

import numpy as np
import pandas as pd

from . import carga
from .config import (
    ABSTENCION_MESES_MOROSO,
    ABSTENCION_N_RECLAMOS,
    ARTIFACTS_DIR,
    GB_ILIMITADO,
    log,
)


def _gasto_actual_total(cli: pd.DataFrame, precio: dict, es_mt_oferta: dict) -> pd.Series:
    p_plan = cli["plan_actual_id"].map(precio).fillna(0.0)
    p_hogar = cli["oferta_hogar_id"].map(precio).fillna(0.0)
    plan_ya_es_mt = cli["plan_actual_id"].map(es_mt_oferta).fillna(False).astype(bool)
    # Si el plan actual ya es un tier MT, el paquete hogar está incluido.
    return np.where(plan_ya_es_mt, p_plan, p_plan + p_hogar).round(2)


def _gap_a_mt(cli: pd.DataFrame) -> pd.Series:
    """Qué le falta al cliente para ser elegible a Movistar Total.

    Requisitos MT: línea móvil postpago + internet hogar.
    La ficha dice que el potencial es toda la planta: ofrecer a cada cliente
    el producto que le falta. `elegible_mt` es el segmento fácil (13,650),
    no el mercado.
    """
    postpago = cli["tipo_cliente"].eq("postpago")
    movil = cli["tiene_movil"]
    inet = cli["tiene_internet_hogar"]
    hogar = cli["tiene_hogar"]

    gap = pd.Series("no_alcanzable", index=cli.index, dtype=object)

    # Le falta más de un producto, o no tiene línea móvil: no es un solo paso.
    gap.loc[movil & postpago & ~inet & hogar] = "internet_hogar"      # tiene TV/fijo, falta internet
    gap.loc[movil & postpago & ~inet & ~hogar] = "producto_hogar"     # falta todo el hogar
    gap.loc[movil & ~postpago & inet] = "migracion_postpago"          # tiene internet, es prepago
    gap.loc[movil & postpago & inet] = "ninguno"                      # ya elegible
    gap.loc[cli["es_movistar_total"]] = "ya_es_mt"
    return gap


def _presion_datos(cli: pd.DataFrame, gb: dict) -> pd.Series:
    """Cuánto se le queda corto el plan. NaN si el plan es ilimitado:
    dividir entre 9999 daría ~0 y escondería justo el caso interesante."""
    gb_plan = cli["plan_actual_id"].map(gb)
    gb_plan = gb_plan.where(gb_plan != GB_ILIMITADO)
    return (cli["consumo_datos_gb_prom"] / gb_plan).replace([np.inf, -np.inf], np.nan).round(4)


def _salud_cliente(cli: pd.DataFrame) -> pd.Series:
    salud = pd.Series("buena", index=cli.index, dtype=object)
    salud.loc[(cli["meses_moroso"] >= 1) | (cli["n_reclamos"] >= 2)] = "observada"
    salud.loc[
        (cli["meses_moroso"] >= ABSTENCION_MESES_MOROSO)
        | (cli["n_reclamos"] >= ABSTENCION_N_RECLAMOS)
    ] = "critica"
    return salud


def construir() -> pd.DataFrame:
    cli = carga.cargar_clientes()
    ofertas = carga.cargar_ofertas()

    precio = dict(zip(ofertas["oferta_id"], ofertas["precio_mensual"]))
    gb = dict(zip(ofertas["oferta_id"], ofertas["gb_incluidos"]))
    nombre = dict(zip(ofertas["oferta_id"], ofertas["nombre_oferta"]))
    es_mt_oferta = dict(zip(ofertas["oferta_id"], ofertas["es_movistar_total"]))

    out = pd.DataFrame({"cliente_id": cli["cliente_id"]})
    out["gasto_actual_total"] = _gasto_actual_total(cli, precio, es_mt_oferta)
    out["presion_datos"] = _presion_datos(cli, gb)
    out["salud_cliente"] = _salud_cliente(cli)
    out["gap_a_mt"] = _gap_a_mt(cli)
    out["plan_actual_nombre"] = cli["plan_actual_id"].map(nombre)
    out["oferta_hogar_nombre"] = cli["oferta_hogar_id"].map(nombre)

    dist = out["gap_a_mt"].value_counts().to_dict()
    a_un_paso = sum(
        dist.get(k, 0)
        for k in ("producto_hogar", "internet_hogar", "migracion_postpago")
    )
    log(f"gap_a_mt: {dist}")
    log(
        f"mercado MT: {dist.get('ninguno', 0):,} ya elegibles "
        f"+ {a_un_paso:,} a un solo producto = {dist.get('ninguno', 0) + a_un_paso:,}"
    )
    log(
        "gasto_actual_total vs monto_facturado_prom: "
        f"delta medio S/ {(out['gasto_actual_total'] - cli['monto_facturado_prom']).mean():.2f}"
    )
    return out


def main() -> None:
    df = construir()
    destino = ARTIFACTS_DIR / "cliente_features.parquet"
    df.to_parquet(destino, index=False)
    log(f"escrito {destino} ({len(df):,} filas)")


if __name__ == "__main__":
    main()
