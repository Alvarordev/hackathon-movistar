import { ArrowRight, Route } from "lucide-react";

import { Badge, Panel, TituloPanel } from "@/components/ui/Base";
import { pct, soles } from "@/lib/api";
import type { RutaMt as TipoRutaMt } from "@/lib/tipos";

/**
 * Ruta de conversión a Movistar Total en dos pasos.
 *
 * Es lo que amplía el mercado de 13,650 a 62,522 clientes. El punto de UX:
 * el paso 1 SUBE la factura, así que mostrarlo solo mata la venta. Los dos
 * pasos van juntos y el ahorro del destino se muestra desde el inicio.
 */
export function RutaMt({ ruta }: { ruta: TipoRutaMt }) {
  return (
    <Panel className="border-acento-borde bg-acento-suave/30">
      <TituloPanel icono={<Route size={12} />}>
        Ruta a Movistar Total
      </TituloPanel>

      <p className="mb-3 text-cuerpo leading-relaxed text-tinta-2">
        {ruta.descripcion}
      </p>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <Paso
          numero={1}
          titulo={ruta.oferta_puente_nombre}
          precio={ruta.oferta_puente_precio}
          pie={`${pct(ruta.prob_puente)} de aceptación`}
          destacado
        />

        <ArrowRight
          size={16}
          className="mx-auto shrink-0 rotate-90 text-tinta-3 sm:rotate-0"
        />

        <Paso
          numero={2}
          titulo={ruta.mt_destino_nombre}
          precio={ruta.mt_destino_precio}
          pie={`ahorra ${soles(ruta.ahorro_soles_proyectado)} al mes`}
          pieExito
        />
      </div>

      <p className="mt-3 border-t border-acento-borde pt-2.5 text-dato leading-relaxed text-tinta-2">
        El paso 1 por sí solo sube la factura. El argumento es la ruta completa:
        al cerrarla, el cliente pasa a pagar{" "}
        <span className="tabular font-semibold text-tinta">
          {soles(ruta.mt_destino_precio)}
        </span>{" "}
        y ahorra{" "}
        <span className="tabular font-semibold text-exito">
          {soles(ruta.ahorro_soles_proyectado)}
        </span>{" "}
        mensuales frente a tener todo por separado.
      </p>
    </Panel>
  );
}

function Paso({
  numero,
  titulo,
  precio,
  pie,
  destacado,
  pieExito,
}: {
  numero: number;
  titulo: string;
  precio: number;
  pie: string;
  destacado?: boolean;
  pieExito?: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-lg border bg-superficie p-3 ${
        destacado ? "border-acento-borde" : "border-borde"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <Badge tono={destacado ? "acento" : "neutro"}>Paso {numero}</Badge>
        {destacado ? (
          <span className="text-etiqueta text-tinta-3">ofrecer ahora</span>
        ) : null}
      </div>
      <p className="text-cuerpo font-semibold">{titulo}</p>
      <p className="tabular mt-0.5 text-cuerpo text-tinta-2">
        {soles(precio)} al mes
      </p>
      <p
        className={`tabular mt-1 text-dato ${
          pieExito ? "font-medium text-exito" : "text-tinta-3"
        }`}
      >
        {pie}
      </p>
    </div>
  );
}
