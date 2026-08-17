/**
 * Tools del copiloto. Todos leen de Postgres a través de `lib/queries`.
 *
 * Esta es la parte que hace que la conversación sea confiable: el LLM no
 * calcula nada. Cada cifra que aparece en pantalla salió de una consulta a la
 * base, y el asesor ve el tool call ocurriendo mientras pasa.
 */
import { tool } from "ai";
import { z } from "zod";

import {
  CANALES,
  CLUSTER_IDS,
  DEPARTAMENTOS,
  EDAD_RANGOS,
  GAPS_MT,
  MOTIVOS,
  SALUD,
  TIPOS_CLIENTE,
  analizarSegmento,
  calcularAhorro,
  evaluarOferta,
  getCliente,
  getJourney,
  getNbo,
  getOfertas,
  getPrioridades,
  getRebate,
  getRutaMt,
} from "@/lib/queries";

const clienteId = z.string().describe("ID del cliente, por ejemplo CLI000131");
const ofertaId = z.string().describe("ID de la oferta, por ejemplo OF021");

const noEncontrado = (que: string, id: string) => ({
  error: `${que} ${id} no existe`,
  instruccion: "Decirle al asesor que no se encontró. No inventar datos.",
});

export const tools = {
  get_cliente: tool({
    description:
      "Ficha del cliente: perfil, consumo, facturación, salud (mora y " +
      "reclamos), persona/segmento, elegibilidad a Movistar Total y gap_a_mt. " +
      "Usar siempre antes de argumentar sobre un cliente.",
    inputSchema: z.object({ cliente_id: clienteId }),
    execute: async ({ cliente_id }) =>
      (await getCliente(cliente_id)) ?? noEncontrado("El cliente", cliente_id),
  }),

  get_nbo: tool({
    description:
      "Recomendaciones de oferta rankeadas por valor esperado " +
      "(prob_contacto x prob_aceptacion), con drivers explicativos, ahorro en " +
      "soles y canal sugerido. ES LA ÚNICA FUENTE de qué ofrecer. Si devuelve " +
      "abstenerse=true, el cliente no es candidato a venta. Revisa siempre " +
      "estos tres campos de la recomendación antes de armar el argumento: " +
      "accion='recordatorio' significa que el cliente YA aceptó esa oferta y " +
      "la contratación quedó pendiente — el approach es retomar y cerrar, no " +
      "vender de nuevo. es_downgrade_datos=true significa que la oferta le da " +
      "menos GB de los que el cliente realmente consume — adviértelo, nunca " +
      "la presentes como ventaja. n_rechazos_previos > 0 significa que el " +
      "cliente ya rechazó esa misma oferta antes (el ranking ya la penaliza " +
      "por eso); usa get_journey para saber el motivo y ajustar el argumento.",
    inputSchema: z.object({
      cliente_id: clienteId,
      canal: z
        .enum(CANALES)
        .optional()
        .describe("Forzar un canal, si el cliente ya está siendo atendido ahí"),
      limit: z.number().int().min(1).max(6).optional(),
    }),
    execute: async ({ cliente_id, canal, limit }) =>
      (await getNbo(cliente_id, { canal, limit })) ??
      noEncontrado("El cliente", cliente_id),
  }),

  get_journey: tool({
    description:
      "Historial de ofrecimientos del cliente: qué se le ofreció, cuándo, por " +
      "qué canal, con qué resultado y motivo de rechazo, más sus fricciones " +
      "(reclamos y mora). Útil para no repetir una oferta ya rechazada.",
    inputSchema: z.object({ cliente_id: clienteId }),
    execute: async ({ cliente_id }) =>
      (await getJourney(cliente_id)) ?? noEncontrado("El cliente", cliente_id),
  }),

  sugerir_rebate: tool({
    description:
      "Qué hacer ante una objeción concreta. Devuelve tasas de recuperación " +
      "medidas sobre el historial, con su n y nivel de confianza, y la " +
      "naturaleza del motivo (qué palanca corresponde y cuál NO).",
    inputSchema: z.object({
      motivo: z
        .enum(MOTIVOS)
        .describe("Motivo del rechazo expresado por el cliente"),
    }),
    execute: async ({ motivo }) =>
      (await getRebate(motivo)) ?? {
        error: "Matriz de rebate no disponible",
      },
  }),

  calcular_ahorro: tool({
    description:
      "Ahorro mensual real en soles de una oferta para un cliente: lo que " +
      "paga hoy sumando todos sus servicios contra lo que pagaría. Usar esto " +
      "en vez de hablar de porcentajes genéricos de ahorro.",
    inputSchema: z.object({ cliente_id: clienteId, oferta_id: ofertaId }),
    execute: async ({ cliente_id, oferta_id }) =>
      (await calcularAhorro(cliente_id, oferta_id)) ??
      noEncontrado("El cliente o la oferta", `${cliente_id}/${oferta_id}`),
  }),

  get_ruta_mt: tool({
    description:
      "Para clientes que aún NO son elegibles a Movistar Total: qué producto " +
      "les falta y la ruta de dos pasos para llegar (oferta puente y luego el " +
      "tier de MT). Devuelve null si el cliente ya es elegible o ya tiene MT.",
    inputSchema: z.object({ cliente_id: clienteId }),
    execute: async ({ cliente_id }) =>
      (await getRutaMt(cliente_id)) ?? {
        ruta_mt: null,
        nota: "Este cliente no tiene ruta de dos pasos: o ya es elegible, o ya tiene MT, o le falta más de un producto.",
      },
  }),

  evaluar_oferta: tool({
    description:
      "Score de UNA oferta concreta para un cliente, con su posición en el " +
      "ranking y la diferencia contra la recomendación #1. Usar cuando el " +
      "asesor pregunte '¿y si le ofrezco X?' o '¿por qué no me recomiendas X?'.",
    inputSchema: z.object({ cliente_id: clienteId, oferta_id: ofertaId }),
    execute: async ({ cliente_id, oferta_id }) =>
      (await evaluarOferta(cliente_id, oferta_id)) ??
      noEncontrado("El cliente o la oferta", `${cliente_id}/${oferta_id}`),
  }),

  proximos_clientes: tool({
    description:
      "Cola de priorización: a qué clientes contactar primero, ordenados por " +
      "valor esperado. Usar cuando el asesor pregunta 'a quién llamo ahora' " +
      "o pide una lista de campaña. Con foco='mt' (default) devuelve la mejor " +
      "oportunidad de blindaje de cada cliente; solo_nunca_ofertados=true " +
      "prioriza a los elegibles que jamás recibieron una oferta MT. " +
      "accion='recordatorio' filtra a solo clientes que ya aceptaron MT y " +
      "tienen la contratación pendiente de cerrar (el lead más caliente); " +
      "accion='oferta' filtra a solo ventas nuevas. Los clientes en " +
      "abstención nunca aparecen.",
    inputSchema: z.object({
      foco: z.enum(["mt", "todos"]).optional(),
      canal: z
        .enum(CANALES)
        .optional()
        .describe("Filtrar por canal sugerido, p. ej. Call Out"),
      solo_nunca_ofertados: z.boolean().optional(),
      accion: z.enum(["oferta", "recordatorio"]).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    execute: async ({ foco, canal, solo_nunca_ofertados, accion, limit }) =>
      getPrioridades({
        foco,
        canal,
        soloNuncaOfertados: solo_nunca_ofertados,
        accion,
        limit: limit ?? 5,
      }),
  }),

  analizar_segmento: tool({
    description:
      "Estadísticas de un GRUPO de clientes, no de uno solo. Usar siempre que " +
      "la pregunta sea sobre un colectivo: un rango de edad, un departamento, " +
      "un segmento o persona, los elegibles a MT, los clientes con mora, o la " +
      "planta entera. También sirve para situar al cliente en atención contra " +
      "su propio grupo: filtra por sus características y compara. Los filtros " +
      "se combinan y todos son opcionales; SIN filtros devuelve la base " +
      "completa. Devuelve tamaño del grupo, perfil promedio, elegibilidad y " +
      "cobertura de Movistar Total, salud, personas, las ofertas que el motor " +
      "más recomienda y la conversión histórica medida.",
    inputSchema: z.object({
      edad_rango: z.enum(EDAD_RANGOS).optional(),
      departamento: z.enum(DEPARTAMENTOS).optional(),
      tipo_cliente: z.enum(TIPOS_CLIENTE).optional(),
      cluster_id: z
        .number()
        .int()
        .min(Math.min(...CLUSTER_IDS))
        .max(Math.max(...CLUSTER_IDS))
        .optional()
        .describe("Cluster/persona del cliente, de 0 a 5"),
      gap_a_mt: z
        .enum(GAPS_MT)
        .optional()
        .describe("Qué le falta al cliente para ser elegible a Movistar Total"),
      salud_cliente: z.enum(SALUD).optional(),
      canal_mas_usado: z.enum(CANALES).optional(),
      elegible_mt: z.boolean().optional(),
      es_movistar_total: z.boolean().optional(),
      es_usuario_app: z.boolean().optional(),
    }),
    execute: async (filtros) => analizarSegmento(filtros),
  }),

  listar_ofertas: tool({
    description:
      "Catálogo completo de las 22 ofertas con precios y características. " +
      "Usar para resolver el nombre o el ID de una oferta que menciona el asesor.",
    inputSchema: z.object({}),
    execute: async () => getOfertas(),
  }),
};

export type Tools = typeof tools;
