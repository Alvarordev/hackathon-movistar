import { stepCountIs, streamText } from "ai";
import { z } from "zod";

import { systemPrompt } from "@/ai/prompt";
import { tools } from "@/ai/tools";
import {
  ProveedorNoConfigurado,
  estaConfigurado,
  getModelo,
  modeloActual,
  proveedorActual,
} from "@/ai/provider";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pasos máximos del loop de tool calling antes de cortar. */
const MAX_PASOS = 6;

/**
 * Cota de la entrada antes de mandarla a un proveedor que cobra por token.
 *
 * No es una medida de seguridad —el endpoint es público a propósito— sino de
 * robustez: sin esto, un bucle del frontend o un pegado gigante se convierten
 * en una factura o en un request colgado. Los topes son holgados para
 * cualquier conversación real de un asesor.
 */
const PeticionChat = z.object({
  cliente_id: z.string().max(40).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(40),
});

type Mensaje = z.infer<typeof PeticionChat>["messages"][number];

function sse(evento: string, datos: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`,
  );
}

/** Resumen corto del resultado de un tool, para mostrarlo en la UI sin
 *  volcar un JSON de 40 líneas en pantalla. */
function resumirResultado(toolName: string, output: unknown): string {
  const o = output as Record<string, any>;
  if (!o || typeof o !== "object") return "listo";
  if (o.error) return String(o.error);

  switch (toolName) {
    case "get_nbo":
      if (o.abstenerse) return "cliente en abstención: no corresponde venta";
      return (
        `${o.recomendaciones?.length ?? 0} recomendaciones, top ${
          o.recomendaciones?.[0]?.oferta_id ?? "—"
        }` + (o.ruta_mt ? " · con ruta a MT en 2 pasos" : "")
      );
    case "get_cliente":
      return `${o.cliente_id}, ${o.tipo_cliente ?? "sin línea móvil"}, gap ${o.gap_a_mt}`;
    case "get_journey":
      return `${o.resumen?.n_ofrecimientos ?? 0} ofrecimientos, ${
        o.resumen?.n_aceptados ?? 0
      } aceptados`;
    case "sugerir_rebate":
      return `motivo ${o.motivo}: ${o.acciones?.length ?? 0} acciones coherentes`;
    case "calcular_ahorro":
      return o.ahorro_soles === null
        ? "no aplica ahorro (oferta aditiva)"
        : `ahorro S/ ${o.ahorro_soles}`;
    case "get_ruta_mt":
      return o.gap ? `ruta vía ${o.oferta_puente_id}` : "sin ruta de dos pasos";
    case "evaluar_oferta":
      return o.en_ranking ? `rank ${o.rank}` : "fuera del ranking";
    case "proximos_clientes":
      return `${o.n ?? 0} clientes priorizados (foco ${o.foco})`;
    case "listar_ofertas":
      return `${o.ofertas?.length ?? 0} ofertas`;
    default:
      return "listo";
  }
}

export async function POST(req: Request) {
  let crudo: unknown;
  try {
    crudo = await req.json();
  } catch {
    return fail("parametro_invalido", "El body debe ser JSON");
  }

  const parseado = PeticionChat.safeParse(crudo);
  if (!parseado.success) {
    const problema = parseado.error.issues[0];
    return fail(
      "parametro_invalido",
      `${problema.path.join(".") || "body"}: ${problema.message}`,
    );
  }
  const body = parseado.data;
  const messages: Mensaje[] = body.messages;

  if (!estaConfigurado()) {
    return fail(
      "llm_no_disponible",
      `Falta la API key para AI_PROVIDER=${process.env.AI_PROVIDER ?? "google"}. ` +
        "Configurarla en el entorno. El resto de la API funciona sin ella.",
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let nToolCalls = 0;
      try {
        const resultado = streamText({
          model: getModelo(),
          system: systemPrompt(body.cliente_id ?? null),
          messages,
          tools,
          stopWhen: stepCountIs(MAX_PASOS),
        });

        controller.enqueue(
          sse("start", {
            proveedor: proveedorActual(),
            modelo: modeloActual(),
            cliente_id: body.cliente_id ?? null,
          }),
        );

        for await (const parte of resultado.fullStream) {
          switch (parte.type) {
            case "text-delta":
              controller.enqueue(sse("text-delta", { delta: parte.text }));
              break;

            // Se emiten mientras ocurren, no al final: el asesor tiene que ver
            // que el copiloto está consultando datos y no improvisando.
            case "tool-call":
              nToolCalls += 1;
              controller.enqueue(
                sse("tool-call", {
                  toolCallId: parte.toolCallId,
                  toolName: parte.toolName,
                  args: parte.input,
                }),
              );
              break;

            case "tool-result":
              controller.enqueue(
                sse("tool-result", {
                  toolCallId: parte.toolCallId,
                  toolName: parte.toolName,
                  resumen: resumirResultado(parte.toolName, parte.output),
                }),
              );
              break;

            case "error":
              controller.enqueue(
                sse("error", {
                  error: "llm_error",
                  detalle: String(parte.error),
                }),
              );
              break;
          }
        }

        controller.enqueue(
          sse("finish", {
            finishReason: await resultado.finishReason,
            toolCalls: nToolCalls,
          }),
        );
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          sse("error", {
            error:
              e instanceof ProveedorNoConfigurado
                ? "llm_no_disponible"
                : "error_interno",
            detalle,
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
