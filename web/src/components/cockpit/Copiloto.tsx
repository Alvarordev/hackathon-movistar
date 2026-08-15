"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import {
  ArrowUp,
  Check,
  Database,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { NOMBRE_TOOL, conversar, type ToolChip } from "@/lib/sse";
import type { MensajeChat } from "@/lib/sse";

interface Turno {
  role: "user" | "assistant";
  content: string;
  chips?: ToolChip[];
  error?: { error: string; detalle: string };
}

/**
 * Los atajos siguen el estado del cliente. Ofrecerle "dame el speech de
 * venta" al asesor cuando el motor decidió abstenerse contradice a la propia
 * herramienta: el centro de la pantalla bloquea la venta y el chat la
 * invitaría igual.
 */
function atajosPara(estado: EstadoCliente): string[] {
  if (estado.abstenerse) {
    return [
      "¿Por qué no puedo ofrecerle nada?",
      "¿Cómo le explico la situación al cliente?",
      "¿Qué hago con este cliente entonces?",
    ];
  }
  const base = ["¿Qué le ofrezco y por qué?", "Dame el speech para abrir la llamada"];
  return estado.tieneRutaMt
    ? [...base, "¿Cómo le explico la ruta a Movistar Total?"]
    : [...base, "¿Qué objeciones puedo esperar?"];
}

export interface EstadoCliente {
  abstenerse: boolean;
  tieneRutaMt: boolean;
}

export interface CopilotoHandle {
  preguntar: (texto: string) => void;
}

/**
 * Copiloto conversacional.
 *
 * Los tool calls se renderizan como chips MIENTRAS ocurren. No es decoración:
 * es lo que le comunica al asesor que las cifras salieron de la base y no de
 * la imaginación del modelo. Sin eso, la confianza en la respuesta se apoya
 * solo en que suene bien.
 */
export const Copiloto = forwardRef<
  CopilotoHandle,
  { clienteId: string; estado: EstadoCliente }
>(
  function Copiloto({ clienteId, estado }, ref) {
    const [turnos, setTurnos] = useState<Turno[]>([]);
    const [entrada, setEntrada] = useState("");
    const [ocupado, setOcupado] = useState(false);
    const finRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [turnos]);

    // Cambiar de cliente reinicia la conversación: arrastrar el contexto del
    // anterior es la forma más rápida de que el copiloto mezcle dos clientes.
    useEffect(() => {
      abortRef.current?.abort();
      setTurnos([]);
      setEntrada("");
      setOcupado(false);
    }, [clienteId]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const enviar = useCallback(
      async (texto: string) => {
        const limpio = texto.trim();
        if (!limpio || ocupado) return;

        const historial: MensajeChat[] = [
          ...turnos
            .filter((t) => !t.error)
            .map((t) => ({ role: t.role, content: t.content })),
          { role: "user" as const, content: limpio },
        ];

        setTurnos((p) => [
          ...p,
          { role: "user", content: limpio },
          { role: "assistant", content: "", chips: [] },
        ]);
        setEntrada("");
        setOcupado(true);

        const ctrl = new AbortController();
        abortRef.current = ctrl;

        // Todas las actualizaciones tocan el último turno, que es el del
        // asistente en curso.
        const actualizar = (fn: (t: Turno) => Turno) =>
          setTurnos((p) => {
            const copia = [...p];
            copia[copia.length - 1] = fn(copia[copia.length - 1]);
            return copia;
          });

        try {
          await conversar(
            { cliente_id: clienteId, messages: historial },
            {
              onToolCall: (chip) =>
                actualizar((t) => ({ ...t, chips: [...(t.chips ?? []), chip] })),
              onToolResult: (id, resumen) =>
                actualizar((t) => ({
                  ...t,
                  chips: (t.chips ?? []).map((c) =>
                    c.toolCallId === id ? { ...c, resumen, listo: true } : c,
                  ),
                })),
              onTexto: (delta) =>
                actualizar((t) => ({ ...t, content: t.content + delta })),
              onError: (e) => actualizar((t) => ({ ...t, error: e })),
            },
            ctrl.signal,
          );
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            actualizar((t) => ({
              ...t,
              error: { error: "error_red", detalle: String(e) },
            }));
          }
        } finally {
          setOcupado(false);
        }
      },
      [clienteId, ocupado, turnos],
    );

    useImperativeHandle(ref, () => ({ preguntar: enviar }), [enviar]);

    return (
      <div className="flex h-full flex-col rounded-panel border border-borde bg-superficie">
        <header className="flex shrink-0 items-center gap-2 border-b border-borde px-3.5 py-2.5">
          <span className="grid size-5 place-items-center rounded bg-acento text-superficie">
            <Sparkles size={12} />
          </span>
          <h2 className="text-[13px] font-semibold">Copiloto</h2>
          <span className="ml-auto text-[11px] text-tinta-3">{clienteId}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-fino p-3.5">
          {turnos.length === 0 ? (
            <div className="flex flex-col gap-3 py-2">
              <p className="text-[13px] leading-relaxed text-tinta-2">
                {estado.abstenerse
                  ? "Este cliente no es candidato a venta. Puedo explicarte por qué y cómo manejar la conversación."
                  : "Pregúntame qué ofrecerle, por qué, o cómo responder una objeción. Todas las cifras que te dé salen de la base de datos."}
              </p>
              <div className="flex flex-col gap-1.5">
                {atajosPara(estado).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => enviar(a)}
                    className="rounded-md border border-borde bg-superficie-2 px-2.5 py-2 text-left text-[13px] text-tinta-2 transition-colors hover:border-acento-borde hover:bg-acento-suave hover:text-acento"
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {turnos.map((t, i) =>
                t.role === "user" ? (
                  <p
                    key={i}
                    className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-acento px-3 py-2 text-[13px] text-superficie"
                  >
                    {t.content}
                  </p>
                ) : (
                  <div key={i} className="flex flex-col gap-2">
                    {t.chips && t.chips.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {t.chips.map((c) => (
                          <li
                            key={c.toolCallId}
                            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
                              c.listo
                                ? "border-exito-borde bg-exito-suave text-exito"
                                : "border-borde bg-superficie-2 text-tinta-3 latido"
                            }`}
                          >
                            {c.listo ? (
                              <Check size={11} className="shrink-0" />
                            ) : (
                              <Database size={11} className="shrink-0" />
                            )}
                            <span className="font-medium">
                              {NOMBRE_TOOL[c.toolName] ?? c.toolName}
                            </span>
                            {c.resumen ? (
                              <span className="truncate opacity-80">
                                · {c.resumen}
                              </span>
                            ) : (
                              <span className="opacity-80">consultando…</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {t.content ? (
                      <div className="md text-[13px] leading-relaxed text-tinta-2">
                        <Markdown>{t.content}</Markdown>
                      </div>
                    ) : null}

                    {t.error ? (
                      <div className="flex gap-2 rounded-md border border-alerta-borde bg-alerta-suave px-2.5 py-2">
                        <TriangleAlert
                          size={14}
                          className="mt-0.5 shrink-0 text-alerta"
                        />
                        <div className="text-[12px]">
                          <p className="font-medium text-alerta">
                            {t.error.error === "llm_no_disponible"
                              ? "El copiloto no está configurado"
                              : "No se pudo responder"}
                          </p>
                          <p className="mt-0.5 text-tinta-2">
                            {t.error.detalle}
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {!t.content && !t.error && ocupado && i === turnos.length - 1
                      ? null
                      : null}
                  </div>
                ),
              )}
            </div>
          )}
          <div ref={finRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(entrada);
          }}
          className="flex shrink-0 items-end gap-2 border-t border-borde p-2.5"
        >
          <textarea
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar(entrada);
              }
            }}
            rows={1}
            placeholder="Pregúntale al copiloto…"
            aria-label="Mensaje para el copiloto"
            className="max-h-28 min-h-[36px] flex-1 resize-none rounded-md border border-borde bg-superficie px-2.5 py-2 text-[13px] outline-none placeholder:text-tinta-3 focus:border-acento-borde focus:ring-2 focus:ring-acento-suave"
          />
          <button
            type="submit"
            disabled={ocupado || !entrada.trim()}
            aria-label="Enviar"
            className="grid size-9 shrink-0 place-items-center rounded-md bg-acento text-superficie transition-opacity disabled:opacity-35"
          >
            {ocupado ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ArrowUp size={15} />
            )}
          </button>
        </form>
      </div>
    );
  },
);
