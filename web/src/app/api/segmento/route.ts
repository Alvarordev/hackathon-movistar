import {
  CANALES,
  CLUSTER_IDS,
  DEPARTAMENTOS,
  EDAD_RANGOS,
  FiltrosSegmento,
  GAPS_MT,
  SALUD,
  TIPOS_CLIENTE,
  analizarSegmento,
} from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Un filtro mal escrito no puede pasar en silencio: devolvería un segmento
 * vacío que parece un hallazgo ("no hay clientes así") cuando en realidad es
 * una errata. Por eso cada parámetro se valida contra su lista y el error dice
 * cuáles son los valores válidos.
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const filtros: FiltrosSegmento = {};

  const texto = <T extends string>(
    param: keyof FiltrosSegmento,
    validos: readonly T[],
  ): Response | null => {
    const v = url.searchParams.get(param);
    if (v === null) return null;
    if (!validos.includes(v as T)) {
      return fail(
        "parametro_invalido",
        `${param} debe ser uno de: ${validos.join(", ")}`,
      );
    }
    (filtros[param] as string) = v;
    return null;
  };

  const booleano = (param: keyof FiltrosSegmento): Response | null => {
    const v = url.searchParams.get(param);
    if (v === null) return null;
    if (v !== "true" && v !== "false") {
      return fail("parametro_invalido", `${param} debe ser true o false`);
    }
    (filtros[param] as boolean) = v === "true";
    return null;
  };

  const errores = [
    texto("edad_rango", EDAD_RANGOS),
    texto("departamento", DEPARTAMENTOS),
    texto("tipo_cliente", TIPOS_CLIENTE),
    texto("gap_a_mt", GAPS_MT),
    texto("salud_cliente", SALUD),
    texto("canal_mas_usado", CANALES),
    booleano("elegible_mt"),
    booleano("es_movistar_total"),
    booleano("es_usuario_app"),
  ].filter((r): r is Response => r !== null);
  if (errores.length) return errores[0];

  const cluster = url.searchParams.get("cluster_id");
  if (cluster !== null) {
    const n = Number(cluster);
    if (!CLUSTER_IDS.includes(n as never)) {
      return fail(
        "parametro_invalido",
        `cluster_id debe ser uno de: ${CLUSTER_IDS.join(", ")}`,
      );
    }
    filtros.cluster_id = n;
  }

  return ok(await analizarSegmento(filtros));
});
