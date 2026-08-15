import { z } from "zod";

import { tools } from "@/ai/tools";
import { estaConfigurado, modeloActual, proveedorActual } from "@/ai/provider";
import { handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Introspección de los tools del copiloto.
 *
 * Sirve para dos cosas: que la UI pueda mostrar qué sabe consultar el
 * copiloto, y para verificar que los esquemas cargan sin necesidad de una
 * API key ni de gastar una llamada al LLM.
 */
export const GET = handler(async () =>
  ok({
    proveedor: proveedorActual(),
    modelo: modeloActual(),
    configurado: estaConfigurado(),
    tools: Object.entries(tools).map(([nombre, def]) => {
      const esquema = (def as { inputSchema?: z.ZodTypeAny }).inputSchema;
      const forma =
        esquema instanceof z.ZodObject ? Object.keys(esquema.shape) : [];
      return {
        nombre,
        descripcion: (def as { description?: string }).description ?? "",
        argumentos: forma,
      };
    }),
  }),
);
