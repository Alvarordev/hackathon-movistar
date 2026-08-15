"""Siembra Postgres desde los CSV crudos. Idempotente: TRUNCATE + COPY."""

from . import carga
from .config import log
from .db import aplicar_schema, connect, copy_df

COLS_OFERTAS = [
    "oferta_id", "nombre_oferta", "tipo_oferta", "segmento_objetivo",
    "es_movistar_total", "precio_mensual", "ahorro_pct", "gb_incluidos",
    "gb_ilimitado", "cluster_hogar", "descripcion_bundle", "descripcion_corta",
]

COLS_CLIENTES = [
    "cliente_id", "tipo_cliente", "antiguedad_meses", "tiene_movil",
    "tiene_hogar", "oferta_hogar_id", "tiene_internet_hogar",
    "es_movistar_total", "elegible_mt", "plan_actual_id",
    "monto_facturado_prom", "edad_rango", "ubicacion_departamento",
    "es_usuario_app", "consumo_datos_gb_prom", "consumo_voz_min_prom",
    "consumo_sms_prom", "uso_app_movistar_prom", "monto_facturado_prom_6m",
    "dias_mora_prom", "meses_moroso", "n_reclamos", "n_actividad_canal",
    "canal_mas_usado",
]

COLS_HISTORIAL = [
    "ofrecimiento_id", "cliente_id", "oferta_id", "fecha", "canal",
    "resultado", "motivo_rechazo", "es_rebate", "contactabilidad",
    "medio_probatorio", "tipo_cliente", "antiguedad_meses", "elegible_mt",
    "es_movistar_total", "nombre_oferta", "tipo_oferta", "oferta_es_mt",
]


def main() -> None:
    with connect() as conn:
        aplicar_schema(conn)

        copy_df(conn, carga.cargar_ofertas()[COLS_OFERTAS], "ofertas")
        copy_df(conn, carga.cargar_clientes()[COLS_CLIENTES], "clientes")

        hist = carga.cargar_historial()
        hist["fecha"] = hist["fecha"].dt.strftime("%Y-%m-%d")
        copy_df(conn, hist[COLS_HISTORIAL], "historial")

    log("seed de datos crudos completo")


if __name__ == "__main__":
    main()
