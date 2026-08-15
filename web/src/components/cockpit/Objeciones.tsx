"use client";

import { useState } from "react";
import { Loader2, MessageCircleWarning, Sparkles } from "lucide-react";

import { Badge, Panel, TituloPanel } from "@/components/ui/Base";
import { etiquetaMotivo, pct } from "@/lib/api";
import type { Motivo, Rebate } from "@/lib/tipos";

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
 * botón. Devuelve la palanca correcta con su tasa medida y su n, más el
 * atajo para pedirle el speech al copiloto.
 */
export function Objeciones({
  onPedirSpeech,
}: {
  onPedirSpeech: (motivo: Motivo, texto: string) => void;
}) {
  const [activo, setActivo] = useState<Motivo | null>(null);
  const [datos, setDatos] = useState<Rebate | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function elegir(motivo: Motivo) {
    if (activo === motivo) {
      setActivo(null);
      setDatos(null);
      return;
    }
    setActivo(motivo);
    setDatos(null);
    setError(null);
    setCargando(true);
    try {
      const res = await fetch(`/api/rebate?motivo=${motivo}`);
      if (!res.ok) throw new Error("No se pudo cargar la matriz de rebate");
      setDatos(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

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
            className={`rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
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
        <p className="mt-3 flex items-center gap-2 text-[13px] text-tinta-3">
          <Loader2 size={14} className="animate-spin" />
          Consultando el historial…
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 text-[13px] text-alerta">{error}</p>
      ) : null}

      {datos && activo ? (
        <div className="aparecer mt-3 border-t border-borde pt-3">
          <p className="text-[13px] leading-relaxed text-tinta-2">
            {datos.explicacion_naturaleza}
          </p>

          <ul className="mt-3 flex flex-col gap-1.5">
            {datos.acciones.slice(0, 3).map((a, i) => (
              <li
                key={a.accion}
                className={`flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 ${
                  i === 0
                    ? "border-exito-borde bg-exito-suave"
                    : "border-borde bg-superficie-2"
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{a.descripcion}</p>
                  <p className="text-[11px] text-tinta-3">
                    medido sobre {a.n.toLocaleString("es-PE")} casos
                    {a.confianza === "baja" ? " · poca evidencia" : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`tabular text-sm font-semibold ${
                      i === 0 ? "text-exito" : "text-tinta-2"
                    }`}
                  >
                    {pct(a.tasa_conversion)}
                  </p>
                  <p className="text-[11px] text-tinta-3">recupera</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Badge>
              Base sin acción: {pct(datos.tasa_base)}
            </Badge>
            <button
              type="button"
              onClick={() =>
                onPedirSpeech(
                  activo,
                  `El cliente objeta: "${etiquetaMotivo(activo)}". Dame el speech exacto para responderle.`,
                )
              }
              className="ml-auto flex items-center gap-1.5 rounded-md bg-acento px-2.5 py-1.5 text-[13px] font-medium text-superficie transition-opacity hover:opacity-90"
            >
              <Sparkles size={13} />
              Pedir speech al copiloto
            </button>
          </div>

          {datos.acciones_descartadas.length > 0 ? (
            <details className="mt-2.5 text-[12px]">
              <summary className="cursor-pointer text-tinta-3 hover:text-tinta-2">
                Acciones descartadas para este motivo
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 pl-1">
                {datos.acciones_descartadas.map((a) => (
                  <li key={a.accion} className="text-tinta-3">
                    <span className="tabular">{pct(a.tasa_conversion)}</span>{" "}
                    {a.descripcion} — no corresponde a la naturaleza de esta
                    objeción
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
