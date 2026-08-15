import { NextResponse } from "next/server";

export type CodigoError =
  | "cliente_no_encontrado"
  | "oferta_no_encontrada"
  | "parametro_invalido"
  | "artefactos_no_disponibles"
  | "llm_no_disponible"
  | "error_interno";

const STATUS: Record<CodigoError, number> = {
  cliente_no_encontrado: 404,
  oferta_no_encontrada: 404,
  parametro_invalido: 400,
  artefactos_no_disponibles: 503,
  llm_no_disponible: 503,
  error_interno: 500,
};

export function fail(error: CodigoError, detalle: string) {
  return NextResponse.json({ error, detalle }, { status: STATUS[error] });
}

export function ok(body: unknown) {
  return NextResponse.json(body);
}

/** Envuelve un handler para que un throw no se escape como HTML de Next. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      // Sin artefactos cargados, las tablas del pipeline no existen todavía.
      if (/relation .* does not exist/.test(detalle)) {
        return fail(
          "artefactos_no_disponibles",
          "Faltan tablas del pipeline. Ejecutar: mise run pipeline && mise run seed",
        );
      }
      console.error("[api]", detalle);
      return fail("error_interno", detalle);
    }
  };
}
