/**
 * Consumo del stream SSE del copiloto.
 *
 * El endpoint emite `tool-call` y `tool-result` MIENTRAS ocurren, a propósito:
 * el asesor tiene que ver que el copiloto está consultando datos y no
 * improvisando. Este parser preserva ese orden y lo entrega por callbacks.
 */

export interface ToolChip {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  resumen?: string;
  listo: boolean;
}

export interface ManejadoresSSE {
  onInicio?: (d: { proveedor: string; modelo: string }) => void;
  onToolCall?: (chip: ToolChip) => void;
  onToolResult?: (toolCallId: string, resumen: string) => void;
  onTexto?: (delta: string) => void;
  onFin?: (d: { finishReason: string; toolCalls: number }) => void;
  onError?: (d: { error: string; detalle: string }) => void;
}

export interface MensajeChat {
  role: "user" | "assistant";
  content: string;
}

/**
 * Envía la conversación y va emitiendo los eventos a medida que llegan.
 * Devuelve cuando el stream termina. `signal` permite cancelar.
 */
export async function conversar(
  cuerpo: { cliente_id?: string; messages: MensajeChat[] },
  h: ManejadoresSSE,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/copiloto/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal,
  });

  // Los errores previos al stream (sin API key, body inválido) vienen como
  // JSON normal, no como SSE.
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null);
    h.onError?.({
      error: err?.error ?? "error_interno",
      detalle: err?.detalle ?? res.statusText,
    });
    return;
  }

  const lector = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Los eventos SSE se separan por línea en blanco. El último fragmento
    // puede estar incompleto: se deja en el buffer para la próxima vuelta.
    const bloques = buffer.split("\n\n");
    buffer = bloques.pop() ?? "";

    for (const bloque of bloques) {
      let evento = "message";
      let datos = "";
      for (const linea of bloque.split("\n")) {
        if (linea.startsWith("event: ")) evento = linea.slice(7).trim();
        else if (linea.startsWith("data: ")) datos += linea.slice(6);
      }
      if (!datos) continue;

      // El servidor es quien define la forma de cada evento (ver el contrato
      // de datos); acá solo se reparte a los manejadores.
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(datos) as Record<string, unknown>;
      } catch {
        continue;
      }

      switch (evento) {
        case "start":
          h.onInicio?.(d as unknown as { proveedor: string; modelo: string });
          break;
        case "tool-call":
          h.onToolCall?.({
            toolCallId: String(d.toolCallId),
            toolName: String(d.toolName),
            args: (d.args ?? {}) as Record<string, unknown>,
            listo: false,
          });
          break;
        case "tool-result":
          h.onToolResult?.(String(d.toolCallId), String(d.resumen ?? ""));
          break;
        case "text-delta":
          h.onTexto?.(String(d.delta ?? ""));
          break;
        case "finish":
          h.onFin?.(
            d as unknown as { finishReason: string; toolCalls: number },
          );
          break;
        case "error":
          h.onError?.({
            error: String(d.error ?? "error_interno"),
            detalle: String(d.detalle ?? ""),
          });
          break;
      }
    }
  }
}

/** Nombre legible de cada tool, para los chips en vivo. */
export const NOMBRE_TOOL: Record<string, string> = {
  get_cliente: "Ficha del cliente",
  get_nbo: "Recomendación",
  get_journey: "Historial",
  sugerir_rebate: "Matriz de rebate",
  calcular_ahorro: "Cálculo de ahorro",
  get_ruta_mt: "Ruta a Movistar Total",
  evaluar_oferta: "Evaluación de oferta",
  proximos_clientes: "Cola de prioridades",
  analizar_segmento: "Análisis de segmento",
  listar_ofertas: "Catálogo",
};
