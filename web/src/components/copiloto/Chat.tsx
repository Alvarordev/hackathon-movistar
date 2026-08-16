"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Database, Square, TriangleAlert } from "lucide-react";

import { NOMBRE_TOOL, conversar, type ToolChip } from "@/lib/sse";
import type { MensajeChat } from "@/lib/sse";

interface Turno {
  role: "user" | "assistant";
  content: string;
  chips?: ToolChip[];
  error?: { error: string; detalle: string };
}

export interface EstadoCliente {
  abstenerse: boolean;
  tieneRutaMt: boolean;
}

export interface CopilotoHandle {
  preguntar: (texto: string) => void;
}

/**
 * Los atajos siguen el estado del cliente. Ofrecerle "dame el speech de
 * venta" al asesor cuando el motor decidió abstenerse contradice a la propia
 * herramienta: el centro de la pantalla bloquea la venta y el chat la
 * invitaría igual.
 *
 * Sin cliente en contexto —en la cola o en supervisión— las preguntas son de
 * planta, que es lo único que el copiloto puede responder ahí.
 */
function atajosPara(estado: EstadoCliente | null): string[] {
  if (!estado) {
    return [
      "¿A quién llamo ahora?",
      "¿Cómo está la planta para Movistar Total?",
      "¿Qué segmento tiene más oportunidad?",
    ];
  }
  if (estado.abstenerse) {
    return [
      "¿Por qué no puedo ofrecerle nada?",
      "¿Cómo le explico la situación al cliente?",
      "¿Qué hago con este cliente entonces?",
    ];
  }
  const base = [
    "¿Qué le ofrezco y por qué?",
    "Dame el speech para abrir la llamada",
  ];
  return estado.tieneRutaMt
    ? [...base, "¿Cómo le explico la ruta a Movistar Total?"]
    : [...base, "¿Qué objeciones puedo esperar?"];
}

const ALTURA_MAX_ENTRADA = 112;

/**
 * Copiloto conversacional.
 *
 * Los tool calls se renderizan como chips MIENTRAS ocurren. No es decoración:
 * es lo que le comunica al asesor que las cifras salieron de la base y no de
 * la imaginación del modelo. Sin eso, la confianza en la respuesta se apoya
 * solo en que suene bien.
 */
export function Chat({
  clienteId,
  estado,
  ref,
}: {
  clienteId: string | null;
  estado: EstadoCliente | null;
  ref?: Ref<CopilotoHandle>;
}) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [entrada, setEntrada] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Si el asesor subió a releer algo, el stream no debe arrastrarlo al fondo.
  const pegadoRef = useRef(true);

  const alFondo = useCallback((suave = false) => {
    const el = listaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? "smooth" : "auto" });
  }, []);

  // Un `scrollIntoView` suave por token pelea consigo mismo cincuenta veces
  // por segundo. Durante el stream el salto es instantáneo y solo si el asesor
  // ya estaba mirando el final.
  useEffect(() => {
    if (pegadoRef.current) alFondo();
  }, [turnos, alFondo]);

  // Cambiar de cliente reinicia la conversación: arrastrar el contexto del
  // anterior es la forma más rápida de que el copiloto mezcle dos clientes.
  useEffect(() => {
    abortRef.current?.abort();
    setTurnos([]);
    setEntrada("");
    setOcupado(false);
    pegadoRef.current = true;
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
      // Mandar un mensaje es pedir ver la respuesta: siempre baja.
      pegadoRef.current = true;
      if (entradaRef.current) entradaRef.current.style.height = "auto";

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
          {
            cliente_id: clienteId ?? undefined,
            messages: historial,
          },
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
        entradaRef.current?.focus();
      }
    },
    [clienteId, ocupado, turnos],
  );

  useImperativeHandle(ref, () => ({ preguntar: enviar }), [enviar]);

  // Sugerencias que sobreviven al primer mensaje. Las que ya se usaron dejan de
  // ofrecerse: repetir una pregunta ya respondida no le sirve a nadie.
  const usados = new Set(
    turnos.filter((t) => t.role === "user").map((t) => t.content),
  );
  const atajosVivos = atajosPara(estado)
    .filter((a) => !usados.has(a))
    .slice(0, 2);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listaRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pegadoRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto scroll-fino p-3.5"
      >
        {turnos.length === 0 ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-cuerpo leading-relaxed text-tinta-2">
              {!estado
                ? "Puedo ayudarte a decidir a quién contactar y a leer los números de la planta. Todas las cifras que te dé salen de la base de datos."
                : estado.abstenerse
                  ? "Este cliente no es candidato a venta. Puedo explicarte por qué y cómo manejar la conversación."
                  : "Pregúntame qué ofrecerle, por qué, o cómo responder una objeción. Todas las cifras que te dé salen de la base de datos."}
            </p>
            <div className="flex flex-col gap-1.5">
              {atajosPara(estado).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => enviar(a)}
                  className="rounded-md border border-borde bg-superficie-2 px-2.5 py-2 text-left text-cuerpo text-tinta-2 outline-none transition-[transform,background-color,border-color,color] duration-150 ease-fuerte hover:border-acento-borde hover:bg-acento-suave hover:text-acento focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
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
                  className="msj-entra ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-acento px-3 py-2 text-cuerpo text-white"
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
                          className={`msj-entra flex items-center gap-1.5 rounded-md border px-2 py-1 text-etiqueta transition-colors duration-300 ${
                            c.listo
                              ? "border-exito-borde bg-exito-suave text-exito"
                              : "latido border-borde bg-superficie-2 text-tinta-3"
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
                    <div className="md text-cuerpo leading-relaxed text-tinta-2">
                      <Markdown remarkPlugins={[remarkGfm]}>
                        {t.content}
                      </Markdown>
                    </div>
                  ) : null}

                  {t.error ? (
                    <div className="msj-entra flex gap-2 rounded-md border border-alerta-borde bg-alerta-suave px-2.5 py-2">
                      <TriangleAlert
                        size={14}
                        className="mt-0.5 shrink-0 text-alerta"
                      />
                      <div className="text-dato">
                        <p className="font-medium text-alerta">
                          {t.error.error === "llm_no_disponible"
                            ? "El copiloto no está configurado"
                            : "No se pudo responder"}
                        </p>
                        <p className="mt-0.5 text-tinta-2">{t.error.detalle}</p>
                      </div>
                    </div>
                  ) : null}

                  {/* Entre el envío y el primer token puede pasar más de un
                      segundo. Sin esto, el chat se queda en blanco y el único
                      indicio de vida está a 300px, en el botón de enviar. */}
                  {ocupado && !t.content && !t.error && i === turnos.length - 1 ? (
                    <div className="flex w-fit items-center gap-1 rounded-lg rounded-bl-sm bg-superficie-2 px-3 py-2.5">
                      <span className="respirar size-1.5 rounded-full bg-tinta-3" />
                      <span className="respirar size-1.5 rounded-full bg-tinta-3 [animation-delay:0.18s]" />
                      <span className="respirar size-1.5 rounded-full bg-tinta-3 [animation-delay:0.36s]" />
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {turnos.length > 0 && !ocupado && atajosVivos.length > 0 ? (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto scroll-fino px-2.5 pb-1.5">
          {atajosVivos.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => enviar(a)}
              className="msj-entra shrink-0 rounded-full border border-borde bg-superficie-2 px-2.5 py-1 text-etiqueta whitespace-nowrap text-tinta-2 outline-none transition-[transform,background-color,border-color,color] duration-150 ease-fuerte hover:border-acento-borde hover:bg-acento-suave hover:text-acento focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {a}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar(entrada);
        }}
        className="flex shrink-0 items-end gap-2 border-t border-borde p-2.5"
      >
        <textarea
          ref={entradaRef}
          value={entrada}
          onChange={(e) => {
            setEntrada(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAX_ENTRADA)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar(entrada);
            }
          }}
          rows={1}
          placeholder="Pregúntale al copiloto…"
          aria-label="Mensaje para el copiloto"
          className="max-h-28 min-h-[36px] flex-1 resize-none rounded-md border border-borde bg-superficie px-2.5 py-2 text-cuerpo outline-none placeholder:text-tinta-3 focus:border-acento-borde focus:ring-2 focus:ring-acento-suave"
        />
        {/* Mientras responde, el botón deja de ser "enviar" y pasa a ser
            "detener": es la única acción que tiene sentido en ese momento, y
            un envío en ese estado se descartaba en silencio. */}
        {ocupado ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Detener la respuesta"
            className="grid size-9 shrink-0 place-items-center rounded-md bg-tinta-2 text-white outline-none transition-[transform,background-color] duration-150 ease-fuerte hover:bg-tinta focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!entrada.trim()}
            aria-label="Enviar"
            className="grid size-9 shrink-0 place-items-center rounded-md bg-acento text-white outline-none transition-[transform,background-color,opacity] duration-150 ease-fuerte hover:bg-acento/90 focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.97] disabled:opacity-35 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </form>
    </div>
  );
}
