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

/**
 * Valores admitidos de las columnas categóricas, verificados contra la base.
 *
 * Sirven a la vez de `z.enum` en los tools —para que el LLM no pueda pedir un
 * segmento que no existe, como "26-35 años"— y de validación en los endpoints
 * REST. Un filtro mal escrito devolvería cero clientes en silencio, que es la
 * peor forma de equivocarse: parece un dato.
 */
export const EDAD_RANGOS = [
  "18-25",
  "26-35",
  "36-45",
  "46-55",
  "56-65",
  "65+",
] as const;

export const DEPARTAMENTOS = [
  "Lima",
  "Arequipa",
  "La Libertad",
  "Piura",
  "Lambayeque",
  "Cusco",
  "Junin",
  "Ica",
  "Otro",
] as const;

export const TIPOS_CLIENTE = ["postpago", "prepago"] as const;

export const GAPS_MT = [
  "ninguno",
  "producto_hogar",
  "internet_hogar",
  "migracion_postpago",
  "no_alcanzable",
  "ya_es_mt",
] as const;

export const SALUD = ["buena", "observada", "critica"] as const;

export const CLUSTER_IDS = [0, 1, 2, 3, 4, 5] as const;

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

// -------------------------------------------------- análisis de segmento

export interface FiltrosSegmento {
  edad_rango?: string;
  departamento?: string;
  tipo_cliente?: string;
  cluster_id?: number;
  gap_a_mt?: string;
  salud_cliente?: string;
  canal_mas_usado?: string;
  elegible_mt?: boolean;
  es_movistar_total?: boolean;
  es_usuario_app?: boolean;
}

/** Fracción con 4 decimales. Devolver n y pct juntos evita que el LLM divida. */
const pct = (n: number, total: number) =>
  total === 0 ? 0 : Number((n / total).toFixed(4));

/**
 * Igual, pero null cuando no hay denominador.
 *
 * Una tasa sobre cero ofrecimientos no es 0%: es "nunca se midió". Devolver 0
 * haría que el copiloto dijera "convierte 0%" de un segmento al que jamás se le
 * ofreció nada, que es lo contrario de lo que pasa.
 */
const tasa = (n: number, total: number) =>
  total === 0 ? null : Number((n / total).toFixed(4));

/**
 * Estadísticas de un grupo de clientes.
 *
 * El resto del motor mira un cliente a la vez, que es lo correcto para armar un
 * argumento. Pero el asesor también pregunta por el colectivo —"¿y los clientes
 * de este rango de edad?"—, y sin esto el copiloto sólo puede responder "no
 * tengo ese dato" sobre datos que sí están en la base.
 *
 * Sin filtros devuelve la planta entera. Cada bloque sale de una consulta
 * agregada real: ninguna cifra de aquí es una estimación.
 */
export async function analizarSegmento(filtros: FiltrosSegmento = {}) {
  const params: unknown[] = [];
  const cond: string[] = [];

  const igual = (columna: string, valor: unknown) => {
    if (valor === undefined) return;
    params.push(valor);
    cond.push(`${columna} = $${params.length}`);
  };

  igual("c.edad_rango", filtros.edad_rango);
  igual("c.ubicacion_departamento", filtros.departamento);
  igual("c.tipo_cliente", filtros.tipo_cliente);
  igual("c.canal_mas_usado", filtros.canal_mas_usado);
  igual("c.elegible_mt", filtros.elegible_mt);
  igual("c.es_movistar_total", filtros.es_movistar_total);
  igual("c.es_usuario_app", filtros.es_usuario_app);
  igual("f.gap_a_mt", filtros.gap_a_mt);
  igual("f.salud_cliente", filtros.salud_cliente);
  igual("p.cluster_id", filtros.cluster_id);

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const desde = `
      FROM clientes c
      LEFT JOIN cliente_features f USING (cliente_id)
      LEFT JOIN personas p USING (cliente_id)
     ${where}`;

  // La cohorte se recalcula dentro de cada consulta en vez de materializarse:
  // son índices distintos y Postgres resuelve mejor cada plan por separado.
  const coh = `WITH coh AS (SELECT c.cliente_id ${desde})`;

  const filtrosAplicados = Object.fromEntries(
    Object.entries(filtros).filter(([, v]) => v !== undefined),
  );

  const [resumen, total] = await Promise.all([
    queryOne<Record<string, any>>(
      `SELECT count(*) AS n_clientes,
              round(avg(c.antiguedad_meses), 1) AS antiguedad_meses_prom,
              round(avg(f.gasto_actual_total), 2) AS gasto_actual_total_prom,
              round(avg(c.consumo_datos_gb_prom), 2) AS consumo_datos_gb_prom,
              round(avg(c.dias_mora_prom), 2) AS dias_mora_prom,
              count(*) FILTER (WHERE c.tipo_cliente = 'postpago') AS n_postpago,
              count(*) FILTER (WHERE c.tipo_cliente = 'prepago') AS n_prepago,
              count(*) FILTER (WHERE c.tipo_cliente IS NULL) AS n_sin_movil,
              count(*) FILTER (WHERE c.es_usuario_app) AS n_usuarios_app,
              count(*) FILTER (WHERE c.elegible_mt) AS n_elegibles,
              count(*) FILTER (WHERE c.es_movistar_total) AS n_ya_mt,
              count(*) FILTER (WHERE c.elegible_mt AND NOT EXISTS (
                SELECT 1 FROM historial h
                 WHERE h.cliente_id = c.cliente_id AND h.oferta_es_mt
              )) AS n_elegibles_nunca_ofertados,
              count(*) FILTER (WHERE f.salud_cliente = 'buena') AS n_salud_buena,
              count(*) FILTER (WHERE f.salud_cliente = 'observada') AS n_salud_observada,
              count(*) FILTER (WHERE f.salud_cliente = 'critica') AS n_salud_critica,
              count(*) FILTER (WHERE COALESCE(p.alerta_retencion, false)) AS n_abstencion
         ${desde}`,
      params,
    ),
    queryOne<{ n: number }>("SELECT count(*) AS n FROM clientes"),
  ]);

  const n: number = resumen?.n_clientes ?? 0;
  const nBase = total?.n ?? 0;

  if (!resumen || n === 0) {
    return {
      filtros_aplicados: filtrosAplicados,
      n_clientes: 0,
      pct_de_la_base: 0,
      confianza: "baja" as const,
      nota: "Ningún cliente de la base cumple esos filtros. No hay nada que promediar: decírselo al asesor tal cual, sin estimar.",
    };
  }

  const [gaps, personas, oportunidad, conversion] = await Promise.all([
    query<Record<string, any>>(
      `${coh} SELECT f.gap_a_mt AS gap, count(*) AS n
                FROM cliente_features f JOIN coh USING (cliente_id)
               GROUP BY 1 ORDER BY 2 DESC`,
      params,
    ),
    query<Record<string, any>>(
      `${coh} SELECT p.cluster_id, p.persona, count(*) AS n
                FROM personas p JOIN coh USING (cliente_id)
               GROUP BY 1, 2 ORDER BY 3 DESC`,
      params,
    ),
    query<Record<string, any>>(
      `${coh} SELECT s.oferta_id, o.nombre_oferta, o.es_movistar_total,
                     count(*) AS n_clientes,
                     round(avg(s.valor_esperado), 4) AS valor_esperado_prom,
                     round(avg(s.ahorro_soles), 2) AS ahorro_soles_prom
                FROM nbo_scores s
                JOIN coh USING (cliente_id)
                JOIN ofertas o USING (oferta_id)
               WHERE s.rank = 1
               GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 5`,
      params,
    ),
    queryOne<Record<string, any>>(
      `${coh} SELECT count(*) AS n_ofrecimientos,
                     count(*) FILTER (WHERE h.resultado = 'aceptada') AS n_aceptadas,
                     count(*) FILTER (WHERE h.oferta_es_mt) AS n_ofrecimientos_mt,
                     count(*) FILTER (WHERE h.oferta_es_mt
                                        AND h.resultado = 'aceptada') AS n_aceptadas_mt
                FROM historial h JOIN coh USING (cliente_id)`,
      params,
    ),
  ]);

  const nOfr: number = conversion?.n_ofrecimientos ?? 0;
  const nOfrMt: number = conversion?.n_ofrecimientos_mt ?? 0;

  return {
    filtros_aplicados: filtrosAplicados,
    n_clientes: n,
    pct_de_la_base: pct(n, nBase),
    // Con pocos clientes los promedios son anécdota, no señal. El mismo
    // criterio que la matriz de rebate aplica a sus tasas.
    confianza: n < 100 ? ("baja" as const) : ("alta" as const),

    perfil: {
      antiguedad_meses_prom: resumen.antiguedad_meses_prom,
      gasto_actual_total_prom: resumen.gasto_actual_total_prom,
      consumo_datos_gb_prom: resumen.consumo_datos_gb_prom,
      dias_mora_prom: resumen.dias_mora_prom,
      n_postpago: resumen.n_postpago,
      n_prepago: resumen.n_prepago,
      n_sin_movil: resumen.n_sin_movil,
      n_usuarios_app: resumen.n_usuarios_app,
      pct_usuarios_app: pct(resumen.n_usuarios_app, n),
    },

    movistar_total: {
      n_elegibles: resumen.n_elegibles,
      pct_elegibles: pct(resumen.n_elegibles, n),
      n_ya_mt: resumen.n_ya_mt,
      pct_ya_mt: pct(resumen.n_ya_mt, n),
      // Cobertura perdida: elegibles a los que nunca se les presentó MT. Es la
      // oportunidad accionable del segmento, no un dato descriptivo.
      n_elegibles_nunca_ofertados: resumen.n_elegibles_nunca_ofertados,
      desglose_gap: gaps.map((g) => ({
        gap: g.gap,
        n: g.n,
        pct: pct(g.n, n),
      })),
    },

    salud: {
      n_buena: resumen.n_salud_buena,
      n_observada: resumen.n_salud_observada,
      n_critica: resumen.n_salud_critica,
      n_abstencion: resumen.n_abstencion,
      pct_abstencion: pct(resumen.n_abstencion, n),
    },

    personas: personas.map((p) => ({
      cluster_id: p.cluster_id,
      persona: p.persona,
      n: p.n,
      pct: pct(p.n, n),
    })),

    oportunidad: oportunidad.map((o) => ({
      oferta_id: o.oferta_id,
      nombre_oferta: o.nombre_oferta,
      es_movistar_total: o.es_movistar_total,
      n_clientes: o.n_clientes,
      pct: pct(o.n_clientes, n),
      valor_esperado_prom: o.valor_esperado_prom,
      ahorro_soles_prom: o.ahorro_soles_prom,
    })),

    conversion_historica: {
      n_ofrecimientos: nOfr,
      n_aceptadas: conversion?.n_aceptadas ?? 0,
      tasa: tasa(conversion?.n_aceptadas ?? 0, nOfr),
      n_ofrecimientos_mt: nOfrMt,
      n_aceptadas_mt: conversion?.n_aceptadas_mt ?? 0,
      tasa_mt: tasa(conversion?.n_aceptadas_mt ?? 0, nOfrMt),
    },

    nota_metodologica:
      "conversion_historica está MEDIDA sobre los ofrecimientos reales del " +
      "historial. oportunidad es una PROYECCIÓN del modelo: qué recomendaría " +
      "hoy a cada cliente del segmento, no lo que ya pasó. No presentar una " +
      "como la otra.",
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
