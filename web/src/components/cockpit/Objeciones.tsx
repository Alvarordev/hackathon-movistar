"use client";

import { useRef, useState } from "react";
import { Info, Loader2, MessageCircleWarning, Sparkles } from "lucide-react";

import { Badge, Origen, Panel, TituloPanel } from "@/components/ui/Base";
import { Button } from "@/components/ui/Button";
import { etiquetaMotivo, pct } from "@/lib/api";
import type { AccionRebate, Motivo, Rebate } from "@/lib/tipos";

const MOTIVOS: Motivo[] = [
  "precio",
  "ya_tiene_similar",
  "no_necesita",
  "no_confia",
  "mal_momento",
  "otro",
];

/**
 * Objeciones de un click.
 *
 * En llamada no hay tiempo de tipear: el asesor oye "está caro" y toca el
 * botón. Devuelve la palanca correcta con su tasa medida y su n.
 *
 * La táctica se elige, no se impone: el motor dice cuál convierte mejor, pero
 * el asesor conoce el tono de la llamada y puede pedir el speech de otra. Lo
 * que no puede es inventarse la tasa, y por eso el prompt que se le manda al
 * copiloto lleva siempre la cifra medida de la táctica elegida.
 */
export function Objeciones({
  onPedirSpeech,
}: {
  onPedirSpeech: (motivo: Motivo, texto: string) => void;
}) {
  const [activo, setActivo] = useState<Motivo | null>(null);
  const [datos, setDatos] = useState<Rebate | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function elegir(motivo: Motivo) {
    // Sin esto, dos clicks seguidos dejan las tasas de una objeción bajo el
    // chip de otra: el asesor leería el número equivocado en voz alta.
    abortRef.current?.abort();

    if (activo === motivo) {
      setActivo(null);
      setDatos(null);
      setSeleccion(null);
      setCargando(false);
      return;
    }
    setActivo(motivo);
    setDatos(null);
    setSeleccion(null);
    setError(null);
    setCargando(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`/api/rebate?motivo=${motivo}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("No se pudo cargar la matriz de rebate");
      const json: Rebate = await res.json();
      setDatos(json);
      setSeleccion(json.acciones[0]?.accion ?? null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setCargando(false);
    }
  }

  const acciones = datos?.acciones.slice(0, 3) ?? [];
  const elegida = acciones.find((a) => a.accion === seleccion) ?? acciones[0];

  const pedirSpeech = (a: AccionRebate) =>
    onPedirSpeech(
      activo!,
      `El cliente objeta: "${etiquetaMotivo(activo!)}". Voy a usar la táctica ` +
        `"${a.descripcion}", que en el historial recuperó ${pct(a.tasa_conversion)} ` +
        `sobre ${a.n.toLocaleString("es-PE")} casos. Dame el speech exacto para ` +
        `aplicarla con este cliente.`,
    );

  return (
    <Panel>
      <TituloPanel icono={<MessageCircleWarning size={12} />}>
        El cliente objeta…
      </TituloPanel>

      <div className="flex flex-wrap gap-1.5">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => elegir(m)}
            aria-pressed={activo === m}
            className={`rounded-md border px-2.5 py-1.5 text-cuerpo font-medium outline-none transition-[transform,background-color,border-color,color] duration-150 ease-fuerte focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${
              activo === m
                ? "border-alerta-borde bg-alerta-suave text-alerta"
                : "border-borde bg-superficie text-tinta-2 hover:border-borde-fuerte hover:bg-superficie-2"
            }`}
          >
            {etiquetaMotivo(m)}
          </button>
        ))}
      </div>

      {cargando ? (
        <p className="mt-3 flex items-center gap-2 text-cuerpo text-tinta-3">
          <Loader2 size={14} className="animate-spin" />
          Consultando el historial…
        </p>
      ) : null}

      {error ? <p className="mt-3 text-cuerpo text-alerta">{error}</p> : null}

      {datos && activo ? (
        <div className="aparecer mt-3 border-t border-borde pt-3">
          <p className="text-cuerpo leading-relaxed text-tinta-2">
            {datos.explicacion_naturaleza}
          </p>

          <p className="mt-3 mb-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
            Elige la táctica
          </p>

          <ul className="flex flex-col gap-1.5">
            {acciones.map((a, i) => {
              const sel = a.accion === elegida?.accion;
              return (
                <li key={a.accion}>
                  <button
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setSeleccion(a.accion)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left outline-none transition-[transform,background-color,border-color,box-shadow] duration-150 ease-fuerte focus-visible:ring-2 focus-visible:ring-acento/40 active:scale-[0.995] motion-reduce:transition-none motion-reduce:active:scale-100 ${
                      i === 0
                        ? "border-exito-borde bg-exito-suave"
                        : "border-borde bg-superficie-2 hover:border-borde-fuerte"
                    } ${sel ? "ring-2 ring-acento-borde" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-cuerpo font-medium">
                          {a.descripcion}
                        </span>
                        {i === 0 ? (
                          <span className="rounded bg-exito/12 px-1 py-px text-etiqueta font-semibold text-exito">
                            la que más recupera
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-etiqueta text-tinta-3">
                        medido sobre {a.n.toLocaleString("es-PE")} casos
                        {a.confianza === "baja" ? " · poca evidencia" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`tabular block text-sm font-semibold ${
                          i === 0 ? "text-exito" : "text-tinta-2"
                        }`}
                      >
                        {pct(a.tasa_conversion)}
                      </span>
                      <span className="block text-etiqueta text-tinta-3">
                        recupera
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Un porcentaje suelto no dice si es mucho o poco. Contra la base
              sin acción, sí. */}
          {elegida ? (
            <p className="mt-2 text-dato leading-relaxed text-tinta-3">
              De cada 100 clientes que objetaron «{etiquetaMotivo(activo)}» y
              recibieron esta táctica,{" "}
              <strong className="font-semibold text-tinta-2">
                {Math.round(elegida.tasa_conversion * 100)} terminaron aceptando
              </strong>
              . Sin ninguna acción, {pct(datos.tasa_base)}.
            </p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Badge>Base sin acción: {pct(datos.tasa_base)}</Badge>
            <Origen>
              {datos.n_total.toLocaleString("es-PE")} objeciones analizadas
            </Origen>

            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variante="outline"
                onClick={() =>
                  onPedirSpeech(
                    activo,
                    `El cliente objeta: "${etiquetaMotivo(activo)}". Dame el speech exacto para responderle.`,
                  )
                }
              >
                Speech general
              </Button>
              {elegida ? (
                <Button onClick={() => pedirSpeech(elegida)}>
                  <Sparkles size={13} />
                  Speech con esta táctica
                </Button>
              ) : null}
            </div>
          </div>

          {datos.acciones_descartadas.length > 0 || datos.nota_metodologica ? (
            <details className="mt-2.5 text-dato">
              <summary className="cursor-pointer text-tinta-3 hover:text-tinta-2">
                Qué se descartó y cómo se midió
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 pl-1">
                {datos.acciones_descartadas.map((a) => (
                  <li key={a.accion} className="text-tinta-3">
                    <span className="tabular">{pct(a.tasa_conversion)}</span>{" "}
                    {a.descripcion} —{" "}
                    {a.razon_descarte ??
                      "no corresponde a la naturaleza de esta objeción"}
                  </li>
                ))}
              </ul>
              {datos.nota_metodologica ? (
                <p className="mt-2 flex gap-1.5 leading-relaxed text-tinta-3">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  {datos.nota_metodologica}
                </p>
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
