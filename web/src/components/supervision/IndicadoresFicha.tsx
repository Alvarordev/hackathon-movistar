import { Target } from "lucide-react";

import { Badge, Panel, TituloPanel } from "@/components/ui/Base";
import { soles } from "@/lib/api";
import type { IndicadorFicha, Metrics } from "@/lib/tipos";

/**
 * Los cinco indicadores que la ficha del desafío declara querer mover, con su
 * estado real.
 *
 * Dos de ellos —churn/permanencia y NPS— no se pueden medir con los datos
 * entregados. Decirlo en pantalla es deliberado: el proyecto ya trata así la
 * contactabilidad no predecible y el `es_rebate` que resultó ser ruido.
 * Inventar un número de churn sería más fácil y menos defendible.
 */
const ETIQUETA_ESTADO: Record<string, { texto: string; tono: TonoBadge }> = {
  medido: { texto: "medido", tono: "exito" },
  medido_y_proyectado: { texto: "medido + proyectado", tono: "exito" },
  protegido_por_politica: { texto: "protegido por política", tono: "acento" },
  no_medible: { texto: "no medible con estos datos", tono: "neutro" },
};

type TonoBadge = "neutro" | "acento" | "exito" | "alerta" | "aviso";

export function IndicadoresFicha({ metrics }: { metrics: Metrics }) {
  const ind = metrics.indicadores_ficha;
  if (!ind) return null;

  const conv = ind.conversion_comercial;
  const arpu = ind.arpu;

  return (
    <Panel>
      <TituloPanel icono={<Target size={12} />}>
        Los indicadores que pide la ficha
      </TituloPanel>

      <p className="mb-3 text-cuerpo leading-relaxed text-tinta-2">
        El desafío nombra cinco indicadores a mover. Tres se pueden medir o
        proyectar con los datos entregados; dos no, y eso también se reporta.
      </p>

      <ul className="flex flex-col divide-y divide-borde border-t border-borde">
        <Fila
          nombre="Tasa de conversión comercial"
          indicador={conv}
          detalle={
            conv
              ? `${(conv.tasa_global! * 100).toFixed(1)}% global · ${(
                  conv.tasa_mt! * 100
                ).toFixed(1)}% en Movistar Total`
              : undefined
          }
        />
        <Fila
          nombre="Participación de MT en la venta"
          indicador={ind.participacion_mt}
          detalle={`${(
            metrics.participacion_mt.venta_hogar_actual_pct * 100
          ).toFixed(1)}% hogar · ${(
            metrics.participacion_mt.venta_movil_actual_pct * 100
          ).toFixed(1)}% móvil, contra metas de 50% y 10%`}
        />
        <Fila
          nombre="ARPU"
          indicador={arpu}
          detalle={
            arpu
              ? `${soles(arpu.arpu_facturado_prom!)} facturado · ${soles(
                  arpu.gasto_real_prom!,
                )} de gasto real promedio`
              : undefined
          }
        />
        <Fila nombre="Churn y permanencia" indicador={ind.churn_permanencia} />
        <Fila nombre="NPS" indicador={ind.nps} />
      </ul>
    </Panel>
  );
}

function Fila({
  nombre,
  indicador,
  detalle,
}: {
  nombre: string;
  indicador?: IndicadorFicha;
  detalle?: string;
}) {
  if (!indicador) return null;
  const estado = ETIQUETA_ESTADO[indicador.estado] ?? {
    texto: indicador.estado,
    tono: "neutro" as TonoBadge,
  };

  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-cuerpo font-medium">{nombre}</span>
        <Badge tono={estado.tono}>{estado.texto}</Badge>
        {detalle ? (
          <span className="tabular text-dato text-tinta-2">{detalle}</span>
        ) : null}
      </div>
      <p className="text-dato leading-relaxed text-tinta-3">{indicador.nota}</p>
    </li>
  );
}
