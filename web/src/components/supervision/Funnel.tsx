"use client";

import { useState } from "react";
import { Filter, Table2 } from "lucide-react";

import { Panel, TituloPanel } from "@/components/ui/Base";
import { Button, Segmentado } from "@/components/ui/Button";
import { numero, pct } from "@/lib/api";
import { CANALES, type Canal, type Funnel as TipoFunnel } from "@/lib/tipos";

/**
 * Funnel E2E del ofrecimiento.
 *
 * Responde el dolor declarado en la ficha: "no existen reportes unificados ni
 * plataformas automáticas de escucha que permitan identificar si un producto
 * fue efectivamente ofrecido, ni trazar el ofrecimiento de extremo a extremo".
 *
 * Las etapas SÍ tienen orden natural, así que llevan rampa ordinal de un solo
 * hue (validada: monotonía de L, salto entre pasos, contraste del extremo
 * claro contra la superficie). Cada barra va con su etiqueta directa: el
 * tooltip nunca es la única forma de leer un valor.
 */
const RAMPA_ETAPAS = [
  "var(--color-rampa-1)",
  "var(--color-rampa-2)",
  "var(--color-rampa-3)",
  "var(--color-rampa-4)",
];

const ETIQUETA_ETAPA: Record<string, string> = {
  ofrecimientos: "Ofrecimientos registrados",
  contactados: "Contacto efectivo",
  con_medio_probatorio: "Con medio probatorio",
  aceptados: "Venta cerrada",
};

export function Funnel({
  inicial,
}: {
  inicial: TipoFunnel;
}) {
  const [canal, setCanal] = useState<Canal | null>(null);
  const [datos, setDatos] = useState<TipoFunnel>(inicial);
  const [refrescando, setRefrescando] = useState(false);
  const [tabla, setTabla] = useState(false);

  async function cambiarCanal(c: Canal | null) {
    setCanal(c);
    setRefrescando(true);
    try {
      const url = c ? `/api/funnel?canal=${encodeURIComponent(c)}` : "/api/funnel";
      const res = await fetch(url);
      setDatos(await res.json());
    } finally {
      setRefrescando(false);
    }
  }

  const tope = datos.etapas[0]?.n || 1;

  return (
    <Panel>
      <TituloPanel
        icono={<Filter size={12} />}
        accion={
          <Button
            variante="ghost"
            tam="sm"
            onClick={() => setTabla((v) => !v)}
            aria-pressed={tabla}
            className="text-tinta-3"
          >
            <Table2 size={12} />
            {tabla ? "Ver gráfico" : "Ver tabla"}
          </Button>
        }
      >
        Trazabilidad del ofrecimiento
      </TituloPanel>

      {/* Un solo filtro arriba, que alcanza a todo lo que está debajo. */}
      <div className="mb-4 flex">
        <Segmentado
          etiquetaGrupo="Canal"
          tam="sm"
          valor={canal ?? "todos"}
          onCambiar={(v) => cambiarCanal(v === "todos" ? null : (v as Canal))}
          opciones={[
            { valor: "todos", etiqueta: "Todos los canales" },
            ...CANALES.map((c) => ({ valor: c as string, etiqueta: c })),
          ]}
        />
      </div>

      {/* Al refrescar se mantiene el render anterior atenuado: un esqueleto
          haría saltar el layout en cada cambio de filtro. */}
      <div className={refrescando ? "opacity-60 transition-opacity" : ""}>
        {tabla ? (
          <table className="w-full text-cuerpo">
            <thead>
              <tr className="border-b border-borde text-left">
                <th className="py-1.5 text-etiqueta font-semibold text-tinta-3 uppercase">
                  Etapa
                </th>
                <th className="py-1.5 text-right text-etiqueta font-semibold text-tinta-3 uppercase">
                  Eventos
                </th>
                <th className="py-1.5 text-right text-etiqueta font-semibold text-tinta-3 uppercase">
                  Del anterior
                </th>
              </tr>
            </thead>
            <tbody>
              {datos.etapas.map((e) => (
                <tr key={e.etapa} className="border-b border-borde last:border-0">
                  <td className="py-1.5">{ETIQUETA_ETAPA[e.etapa] ?? e.etapa}</td>
                  <td className="tabular py-1.5 text-right">{numero(e.n)}</td>
                  <td className="tabular py-1.5 text-right text-tinta-2">
                    {e.pct_del_anterior === null ? "—" : pct(e.pct_del_anterior, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ol className="flex flex-col gap-2">
            {datos.etapas.map((e, i) => (
              <li key={e.etapa}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="text-cuerpo text-tinta-2">
                    {ETIQUETA_ETAPA[e.etapa] ?? e.etapa}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="tabular text-cuerpo font-semibold">
                      {numero(e.n)}
                    </span>
                    {e.pct_del_anterior !== null ? (
                      <span className="tabular w-12 text-right text-etiqueta text-tinta-3">
                        {pct(e.pct_del_anterior, 1)}
                      </span>
                    ) : (
                      <span className="w-12" />
                    )}
                  </span>
                </div>
                <div
                  className="h-6 w-full overflow-hidden rounded-r-[4px] bg-superficie-2"
                  role="img"
                  aria-label={`${ETIQUETA_ETAPA[e.etapa] ?? e.etapa}: ${numero(e.n)} eventos`}
                >
                  <div
                    className="h-full rounded-r-[4px]"
                    style={{
                      width: `${Math.max(1.5, (e.n / tope) * 100)}%`,
                      background: RAMPA_ETAPAS[i] ?? RAMPA_ETAPAS.at(-1),
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-4 grid gap-3 border-t border-borde pt-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
            Medios probatorios
          </p>
          <ul className="flex flex-col gap-1">
            {Object.entries(datos.medios_probatorios).map(([k, v]) => (
              <li
                key={k}
                className="flex items-baseline justify-between text-cuerpo"
              >
                <span className="text-tinta-2">
                  {k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
                </span>
                <span className="tabular font-medium">{numero(v)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
            Movistar Total
          </p>
          <ul className="flex flex-col gap-1 text-cuerpo">
            <li className="flex items-baseline justify-between">
              <span className="text-tinta-2">Ofrecimientos con MT</span>
              <span className="tabular font-medium">
                {pct(datos.mt.pct_ofrecimientos_con_mt, 1)}
              </span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-tinta-2">De la venta fue MT</span>
              <span className="tabular font-medium text-acento">
                {pct(datos.mt.pct_venta_con_mt, 1)}
              </span>
            </li>
            <li className="flex items-baseline justify-between">
              <span className="text-tinta-2">Ventas MT</span>
              <span className="tabular font-medium">
                {numero(datos.mt.aceptados_mt)}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}

