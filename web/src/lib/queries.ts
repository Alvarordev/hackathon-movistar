/**
 * Acceso a datos. Punto único: los endpoints REST y los tools del copiloto
 * llaman a estas mismas funciones.
 *
 * Esto no es sólo higiene: es lo que garantiza que el copiloto no pueda decir
 * una cifra distinta a la que muestra la pantalla. Si el LLM y la UI leyeran
 * por caminos distintos, tarde o temprano divergen.
 */
import { getArtefacto, query, queryOne } from "./db";

export const MOTIVOS = [
  "precio",
  "ya_tiene_similar",
  "no_necesita",
  "no_confia",
  "mal_momento",
  "otro",
] as const;

export const CANALES = ["Tienda", "Call In", "Call Out", "Digital"] as const;
export type Canal = (typeof CANALES)[number];

export interface Driver {
  feature: string;
  valor: number | string | boolean;
  contribucion: number;
  texto: string;
}

export interface ProbaCanal {
  canal: string;
  prob_contacto: number;
  prob_aceptacion: number;
  valor_esperado: number;
}

// --------------------------------------------------------------- clientes

const SQL_CLIENTE = `
  SELECT c.cliente_id, c.tipo_cliente, c.antiguedad_meses, c.tiene_movil,
         c.tiene_hogar, c.tiene_internet_hogar, c.es_movistar_total,
         c.elegible_mt, c.plan_actual_id, c.oferta_hogar_id,
         c.monto_facturado_prom, c.monto_facturado_prom_6m, c.edad_rango,
         c.ubicacion_departamento AS departamento, c.es_usuario_app,
         c.consumo_datos_gb_prom, c.consumo_voz_min_prom, c.consumo_sms_prom,
         c.uso_app_movistar_prom, c.canal_mas_usado, c.n_actividad_canal,
         c.dias_mora_prom, c.meses_moroso, c.n_reclamos,
         f.gasto_actual_total, f.presion_datos, f.salud_cliente, f.gap_a_mt,
         f.plan_actual_nombre, f.oferta_hogar_nombre,
         p.cluster_id, p.persona, p.persona_desc,
         p.alerta_retencion, p.motivo_alerta
    FROM clientes c
    LEFT JOIN cliente_features f USING (cliente_id)
    LEFT JOIN personas p USING (cliente_id)
   WHERE c.cliente_id = $1`;

export async function getCliente(clienteId: string) {
  const r = await queryOne<Record<string, unknown>>(SQL_CLIENTE, [clienteId]);
  if (!r) return null;
  const { cluster_id, persona, persona_desc, ...resto } = r;
  return {
    ...resto,
    persona:
      cluster_id === null || cluster_id === undefined
        ? null
        : { cluster_id, nombre: persona, descripcion: persona_desc },
  };
}

export async function existeCliente(clienteId: string): Promise<boolean> {
  const r = await queryOne("SELECT 1 FROM clientes WHERE cliente_id = $1", [
    clienteId,
  ]);
  return r !== null;
}

// -------------------------------------------------------------------- NBO

const SQL_NBO = `
  SELECT s.oferta_id, s.rank, s.canal_sugerido, s.canal_origen,
         s.momento_sugerido, s.momento_origen, s.avanza_a_mt,
         s.prob_contacto, s.prob_aceptacion, s.valor_esperado,
         s.ahorro_soles, s.ahorro_pct_real, s.drivers, s.por_canal,
         o.nombre_oferta, o.tipo_oferta, o.descripcion_corta,
         o.precio_mensual, o.es_movistar_total, o.gb_incluidos, o.gb_ilimitado
    FROM nbo_scores s
    JOIN ofertas o USING (oferta_id)
   WHERE s.cliente_id = $1
   ORDER BY s.rank`;

const SQL_RUTA = `
  SELECT gap_a_mt AS gap, descripcion, oferta_puente_id, oferta_puente_nombre,
         oferta_puente_precio, prob_puente, mt_destino_id, mt_destino_nombre,
         mt_destino_precio, ahorro_soles_proyectado
    FROM ruta_mt WHERE cliente_id = $1`;

function formatearRecomendacion(r: Record<string, any>) {
  return {
    rank: r.rank,
    oferta_id: r.oferta_id,
    nombre_oferta: r.nombre_oferta,
    tipo_oferta: r.tipo_oferta,
    descripcion_corta: r.descripcion_corta,
    precio_mensual: r.precio_mensual,
    es_movistar_total: r.es_movistar_total,
    gb_incluidos: r.gb_ilimitado ? null : r.gb_incluidos,
    gb_ilimitado: r.gb_ilimitado,
    canal_sugerido: r.canal_sugerido,
    // De dónde sale cada sugerencia. El asesor tiene derecho a saber qué está
    // respaldado por el modelo y qué por una regla.
    canal_origen: r.canal_origen,
    momento_sugerido: r.momento_sugerido,
    momento_origen: r.momento_origen,
    prob_contacto: r.prob_contacto,
    prob_aceptacion: r.prob_aceptacion,
    valor_esperado: r.valor_esperado,
    ahorro_soles: r.ahorro_soles,
    ahorro_pct_real: r.ahorro_pct_real,
    avanza_a_mt: r.avanza_a_mt,
    drivers: (r.drivers ?? []) as Driver[],
    por_canal: (r.por_canal ?? []) as ProbaCanal[],
  };
}

export async function getNbo(
  clienteId: string,
  opts: { canal?: string; limit?: number } = {},
) {
  const cli = await queryOne<{
    alerta_retencion: boolean;
    motivo_alerta: string | null;
  }>(
    `SELECT COALESCE(p.alerta_retencion, false) AS alerta_retencion,
            p.motivo_alerta
       FROM clientes c LEFT JOIN personas p USING (cliente_id)
      WHERE c.cliente_id = $1`,
    [clienteId],
  );
  if (!cli) return null;

  const ruta = await queryOne<Record<string, unknown>>(SQL_RUTA, [clienteId]);

  // Abstención: con mora o reclamos altos la recomendación no es un upsell,
  // es una alerta. Se devuelve la lista vacía a propósito para que ninguna
  // capa de arriba pueda "aprovechar" igual las recomendaciones.
  if (cli.alerta_retencion) {
    return {
      cliente_id: clienteId,
      abstenerse: true,
      motivo_abstencion: cli.motivo_alerta,
      recomendaciones: [],
      ruta_mt: ruta,
    };
  }

  const filas = await query<Record<string, any>>(SQL_NBO, [clienteId]);
  let recs = filas.map(formatearRecomendacion);

  // Simulador de canal: "el cliente ya está en la tienda, ¿qué le ofrezco?".
  // Se re-rankea con las probabilidades de ESE canal, que ya vienen
  // precalculadas en por_canal.
  if (opts.canal) {
    recs = recs
      .map((rec) => {
        const pc = rec.por_canal.find((p) => p.canal === opts.canal);
        return pc
          ? {
              ...rec,
              canal_sugerido: opts.canal!,
              canal_origen: "forzado_por_asesor",
              prob_contacto: pc.prob_contacto,
              prob_aceptacion: pc.prob_aceptacion,
              valor_esperado: pc.valor_esperado,
            }
          : rec;
      })
      .sort((a, b) => b.valor_esperado - a.valor_esperado)
      .map((rec, i) => ({ ...rec, rank: i + 1 }));
  }

  if (opts.limit) recs = recs.slice(0, opts.limit);

  return {
    cliente_id: clienteId,
    abstenerse: false,
    motivo_abstencion: null,
    recomendaciones: recs,
    ruta_mt: ruta,
  };
}

export async function getRutaMt(clienteId: string) {
  return queryOne<Record<string, unknown>>(SQL_RUTA, [clienteId]);
}

/** Score de UNA oferta concreta, con el porqué de su posición en el ranking. */
export async function evaluarOferta(clienteId: string, ofertaId: string) {
  const filas = await query<Record<string, any>>(SQL_NBO, [clienteId]);
  const rec = filas.find((f) => f.oferta_id === ofertaId);
  if (!rec) {
    const oferta = await queryOne<{ nombre_oferta: string }>(
      "SELECT nombre_oferta FROM ofertas WHERE oferta_id = $1",
      [ofertaId],
    );
    if (!oferta) return null;
    return {
      cliente_id: clienteId,
      oferta_id: ofertaId,
      nombre_oferta: oferta.nombre_oferta,
      en_ranking: false,
      motivo: (
        "No está entre las recomendaciones de este cliente: o no es elegible " +
        "para contratarla, o quedó fuera del top por valor esperado."
      ),
    };
  }
  const top = filas[0];
  return {
    cliente_id: clienteId,
    en_ranking: true,
    ...formatearRecomendacion(rec),
    comparacion_con_top1: {
      oferta_id: top.oferta_id,
      nombre_oferta: top.nombre_oferta,
      valor_esperado: top.valor_esperado,
      diferencia_valor_esperado: Number(
        (top.valor_esperado - rec.valor_esperado).toFixed(4),
      ),
    },
  };
}

/** Ahorro real en soles: lo que paga hoy contra lo que pagaría. */
export async function calcularAhorro(clienteId: string, ofertaId: string) {
  const r = await queryOne<Record<string, any>>(
    `SELECT f.gasto_actual_total, c.monto_facturado_prom,
            o.precio_mensual, o.nombre_oferta, o.tipo_oferta,
            s.ahorro_soles, s.ahorro_pct_real
       FROM clientes c
       JOIN cliente_features f USING (cliente_id)
       CROSS JOIN ofertas o
       LEFT JOIN nbo_scores s
              ON s.cliente_id = c.cliente_id AND s.oferta_id = o.oferta_id
      WHERE c.cliente_id = $1 AND o.oferta_id = $2`,
    [clienteId, ofertaId],
  );
  if (!r) return null;
  return {
    cliente_id: clienteId,
    oferta_id: ofertaId,
    nombre_oferta: r.nombre_oferta,
    gasto_actual_total: r.gasto_actual_total,
    monto_facturado_prom: r.monto_facturado_prom,
    precio_oferta: r.precio_mensual,
    ahorro_soles: r.ahorro_soles,
    ahorro_pct: r.ahorro_pct_real,
    nota:
      r.ahorro_soles === null
        ? "Esta oferta se suma a la factura, no reemplaza un servicio actual: no corresponde hablar de ahorro."
        : "gasto_actual_total suma el plan móvil y el paquete hogar del catálogo. monto_facturado_prom refleja solo el plan móvil.",
  };
}

// ----------------------------------------------------------- priorización

/**
 * Cola de priorización: a quién contactar primero.
 *
 * Es la parte proactiva del motor — "identificar al cliente potencial" de la
 * ficha. Con foco 'mt' devuelve la mejor oportunidad de blindaje de cada
 * cliente (oferta MT directa o el puente que cierra su gap).
 * `nunca_ofrecido_mt` marca la cobertura perdida: elegibles a los que jamás
 * se les presentó MT.
 *
 * ORDEN: el mismo criterio que el ranking dentro de un cliente. El valor
 * esperado se agrupa a 2 decimales porque con AUC 0.587 las diferencias
 * menores son ruido, no señal; dentro de ese grupo manda el ahorro. Sin esto,
 * un cliente al que MT le cuesta S/ 0.10 MÁS encabeza la cola por delante de
 * uno que ahorraría S/ 89.90 — la diferencia de VE entre ambos (0.4317 vs
 * 0.4315) no significa nada, pero la de ahorro decide la venta.
 *
 * Los clientes en abstención no aparecen: llamarlos para vender es
 * exactamente el error que el motor existe para evitar.
 */
export async function getPrioridades(opts: {
  foco?: "mt" | "todos";
  canal?: string;
  soloNuncaOfertados?: boolean;
  limit?: number;
}) {
  const foco = opts.foco ?? "mt";
  const limit = Math.min(opts.limit ?? 25, 200);
  const params: unknown[] = [];
  const cond: string[] = ["NOT COALESCE(p.alerta_retencion, false)"];

  if (foco === "mt") cond.push("s.avanza_a_mt");
  if (opts.canal) {
    params.push(opts.canal);
    cond.push(`s.canal_sugerido = $${params.length}`);
  }
  if (opts.soloNuncaOfertados) {
    cond.push(`NOT EXISTS (
      SELECT 1 FROM historial h
       WHERE h.cliente_id = s.cliente_id AND h.oferta_es_mt)`);
  }
  params.push(limit);

  const filas = await query<Record<string, any>>(
    `WITH mejor AS (
       SELECT DISTINCT ON (s.cliente_id)
              s.cliente_id, s.oferta_id, s.rank, s.valor_esperado,
              s.prob_aceptacion, s.ahorro_soles, s.canal_sugerido, s.avanza_a_mt
         FROM nbo_scores s
         LEFT JOIN personas p ON p.cliente_id = s.cliente_id
        WHERE ${cond.join(" AND ")}
        ORDER BY s.cliente_id, s.rank
     )
     SELECT m.*, o.nombre_oferta, o.es_movistar_total,
            f.gap_a_mt, p.persona,
            r.oferta_puente_id IS NOT NULL AS tiene_ruta_mt,
            r.ahorro_soles_proyectado,
            NOT EXISTS (
              SELECT 1 FROM historial h
               WHERE h.cliente_id = m.cliente_id AND h.oferta_es_mt
            ) AS nunca_ofrecido_mt
       FROM mejor m
       JOIN ofertas o USING (oferta_id)
       LEFT JOIN cliente_features f ON f.cliente_id = m.cliente_id
       LEFT JOIN personas p ON p.cliente_id = m.cliente_id
       LEFT JOIN ruta_mt r ON r.cliente_id = m.cliente_id
      ORDER BY round(m.valor_esperado, 2) DESC,
               m.ahorro_soles DESC NULLS LAST,
               m.valor_esperado DESC
      LIMIT $${params.length}`,
    params,
  );

  return {
    foco,
    canal: opts.canal ?? null,
    solo_nunca_ofertados: Boolean(opts.soloNuncaOfertados),
    n: filas.length,
    clientes: filas,
  };
}

// ---------------------------------------------------------------- journey

export async function getJourney(clienteId: string) {
  const eventos = await query<Record<string, any>>(
    `SELECT ofrecimiento_id, fecha, oferta_id, nombre_oferta, tipo_oferta,
            oferta_es_mt, canal, contactabilidad, resultado, motivo_rechazo,
            es_rebate, medio_probatorio
       FROM historial WHERE cliente_id = $1 ORDER BY fecha, ofrecimiento_id`,
    [clienteId],
  );

  const cli = await queryOne<Record<string, any>>(
    `SELECT n_reclamos, meses_moroso, dias_mora_prom
       FROM clientes WHERE cliente_id = $1`,
    [clienteId],
  );
  if (!cli) return null;

  const rechazados = eventos.filter((e) => e.resultado === "rechazada");
  const conteo = new Map<string, number>();
  for (const e of rechazados) {
    if (e.motivo_rechazo)
      conteo.set(e.motivo_rechazo, (conteo.get(e.motivo_rechazo) ?? 0) + 1);
  }
  const dominante =
    [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const ofrecidosMt = eventos.filter((e) => e.oferta_es_mt).length;

  return {
    cliente_id: clienteId,
    resumen: {
      n_ofrecimientos: eventos.length,
      n_aceptados: eventos.filter((e) => e.resultado === "aceptada").length,
      n_rechazados: rechazados.length,
      n_no_contactado: eventos.filter(
        (e) => e.contactabilidad === "no_contactado",
      ).length,
      veces_ofrecido_mt: ofrecidosMt,
      nunca_ofrecido_mt: ofrecidosMt === 0,
      motivo_rechazo_dominante: dominante,
    },
    eventos,
    fricciones: [
      { tipo: "reclamo", n: cli.n_reclamos },
      {
        tipo: "mora",
        meses: cli.meses_moroso,
        dias_prom: cli.dias_mora_prom,
      },
    ],
  };
}

// ---------------------------------------------------- artefactos agregados

export async function getRebate(motivo?: string) {
  const art = await getArtefacto<any>("rebate_matrix");
  if (!art) return null;
  const payload = art.payload;
  if (!motivo) return payload;
  const m = payload.motivos.find((x: any) => x.motivo === motivo);
  return m ? { ...m, nota_metodologica: payload.nota_metodologica } : null;
}

export async function getFunnel(canal?: string) {
  const art = await getArtefacto<any>("funnel");
  if (!art) return null;
  if (!canal) return art.payload;
  return art.payload.por_canal.find((c: any) => c.canal === canal) ?? null;
}

export async function getMetrics() {
  const art = await getArtefacto<any>("metrics");
  if (!art) return null;
  return { generado_en: art.generado_en, ...art.payload };
}

export async function getOfertas() {
  const ofertas = await query(
    `SELECT oferta_id, nombre_oferta, tipo_oferta, segmento_objetivo,
            es_movistar_total, precio_mensual,
            CASE WHEN gb_ilimitado THEN NULL ELSE gb_incluidos END AS gb_incluidos,
            gb_ilimitado, cluster_hogar, descripcion_bundle, descripcion_corta
       FROM ofertas ORDER BY oferta_id`,
  );
  return { ofertas };
}
