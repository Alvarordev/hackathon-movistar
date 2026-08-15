"use client";

import { useState } from "react";
import { ChevronDown, Layers, Shield } from "lucide-react";

import { Badge, Panel, TituloPanel } from "@/components/ui/Base";
import { pct, soles } from "@/lib/api";
import type { Recomendacion } from "@/lib/tipos";

/**
 * Alternativas #2 en adelante. Colapsadas por defecto: el asesor necesita UNA
 * decisión, no seis. Se abren cuando el cliente pide otra cosa.
 *
 * Al expandir muestra el desglose por canal, que es la respuesta a "¿y si lo
 * llamo en vez de escribirle?".
 */
export function Alternativas({
  recomendaciones,
  onPreguntar,
}: {
  recomendaciones: Recomendacion[];
  onPreguntar: (texto: string) => void;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  if (recomendaciones.length === 0) return null;

  return (
    <Panel padding={false}>
      <div className="px-4 pt-4">
        <TituloPanel icono={<Layers size={12} />}>
          Otras opciones para este cliente
        </TituloPanel>
      </div>

      <ul>
        {recomendaciones.map((rec) => {
          const abierto = abierta === rec.oferta_id;
          return (
            <li key={rec.oferta_id} className="border-t border-borde">
              <button
                type="button"
                onClick={() => setAbierta(abierto ? null : rec.oferta_id)}
                aria-expanded={abierto}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-superficie-2"
              >
                <span className="tabular w-5 shrink-0 text-[13px] text-tinta-3">
                  {rec.rank}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">
                      {rec.nombre_oferta}
                    </span>
                    {rec.avanza_a_mt ? (
                      <Shield size={11} className="shrink-0 text-acento" />
                    ) : null}
                  </span>
                  <span className="tabular block text-[11px] text-tinta-3">
                    {soles(rec.precio_mensual)} al mes
                  </span>
                </span>

                <span className="tabular shrink-0 text-right text-[13px]">
                  <span className="block font-semibold">
                    {pct(rec.prob_aceptacion)}
                  </span>
                  <span className="block text-[11px] text-tinta-3">
                    aceptación
                  </span>
                </span>

                <span className="tabular w-20 shrink-0 text-right text-[13px]">
                  {rec.ahorro_soles === null ? (
                    <span className="text-tinta-3">—</span>
                  ) : rec.ahorro_soles > 0 ? (
                    <span className="font-medium text-exito">
                      {soles(rec.ahorro_soles)}
                    </span>
                  ) : (
                    <span className="text-tinta-3">
                      +{soles(rec.ahorro_soles)}
                    </span>
                  )}
                </span>

                <ChevronDown
                  size={15}
                  className={`shrink-0 text-tinta-3 transition-transform ${
                    abierto ? "rotate-180" : ""
                  }`}
                />
              </button>

              {abierto ? (
                <div className="aparecer bg-superficie-2 px-4 py-3">
                  {rec.drivers.length > 0 ? (
                    <ul className="mb-3 flex flex-col gap-1">
                      {rec.drivers.map((d) => (
                        <li
                          key={d.feature}
                          className="flex gap-2 text-[12px] text-tinta-2"
                        >
                          <span
                            aria-hidden
                            className="mt-1.5 size-1 shrink-0 rounded-full bg-tinta-3"
                          />
                          {d.texto}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-tinta-3 uppercase">
                    Por canal
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {rec.por_canal.map((p) => (
                      <Badge
                        key={p.canal}
                        tono={p.canal === rec.canal_sugerido ? "acento" : "neutro"}
                      >
                        {p.canal}: {pct(p.prob_aceptacion)}
                      </Badge>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onPreguntar(
                        `¿Por qué me recomiendas la #1 y no ${rec.nombre_oferta}?`,
                      )
                    }
                    className="mt-3 rounded-md border border-borde bg-superficie px-2.5 py-1.5 text-[12px] font-medium text-tinta-2 hover:bg-superficie-2"
                  >
                    Preguntar por qué no es la #1
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
