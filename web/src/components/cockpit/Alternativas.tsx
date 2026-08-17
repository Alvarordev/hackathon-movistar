"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, History, Layers, Shield } from "lucide-react";

import { Badge, Panel, TituloPanel } from "@/components/ui/Base";
import { Button } from "@/components/ui/Button";
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
                <span className="tabular w-5 shrink-0 text-cuerpo text-tinta-3">
                  {rec.rank}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-cuerpo font-medium">
                      {rec.nombre_oferta}
                    </span>
                    {rec.avanza_a_mt ? (
                      <Shield size={11} className="shrink-0 text-acento" />
                    ) : null}
                    {rec.es_downgrade_datos ? (
                      <span title="Menos GB de los que el cliente usa/tiene hoy">
                        <AlertTriangle size={11} className="shrink-0 text-alerta" />
                      </span>
                    ) : null}
                    {rec.n_rechazos_previos > 0 ? (
                      <span
                        title={`Rechazada ${rec.n_rechazos_previos} veces antes`}
                      >
                        <History size={11} className="shrink-0 text-tinta-3" />
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular block text-etiqueta text-tinta-3">
                    {soles(rec.precio_mensual)} al mes
                  </span>
                </span>

                <span className="tabular shrink-0 text-right text-cuerpo">
                  <span className="block font-semibold">
                    {pct(rec.prob_aceptacion)}
                  </span>
                  <span className="block text-etiqueta text-tinta-3">
                    aceptación
                  </span>
                </span>

                <span className="tabular w-20 shrink-0 text-right text-cuerpo">
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
                          className="flex gap-2 text-dato text-tinta-2"
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

                  <p className="mb-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
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

                  <Button
                    variante="outline"
                    tam="sm"
                    className="mt-3"
                    onClick={() =>
                      onPreguntar(
                        `¿Por qué me recomiendas la #1 y no ${rec.nombre_oferta}?`,
                      )
                    }
                  >
                    Preguntar por qué no es la #1
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
