import {
  AlertTriangle,
  Smartphone,
  TriangleAlert,
  User,
  Wifi,
} from "lucide-react";

import { Badge, Dato, Panel, TituloPanel } from "@/components/ui/Base";
import { etiquetaGap, numero, soles } from "@/lib/api";
import type { Cliente } from "@/lib/tipos";

const TONO_SALUD = {
  buena: "exito",
  observada: "aviso",
  critica: "alerta",
} as const;

const TEXTO_SALUD = {
  buena: "Sin fricciones",
  observada: "Con observaciones",
  critica: "Situación crítica",
} as const;

export function FichaCliente({ cliente }: { cliente: Cliente }) {
  const extra = cliente.gasto_actual_total - cliente.monto_facturado_prom;

  return (
    <div className="flex flex-col gap-3">
      {/* La alerta va primero y ocupa el ancho completo: si el cliente no es
          candidato a venta, el asesor tiene que verlo antes que nada. */}
      {cliente.alerta_retencion ? (
        <Panel className="border-alerta-borde bg-alerta-suave">
          <div className="flex gap-2.5">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-alerta" />
            <div>
              <p className="text-sm font-semibold text-alerta">
                No corresponde venta
              </p>
              <p className="mt-1 text-cuerpo text-tinta-2">
                {cliente.motivo_alerta}
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      {/* Buyer persona.
          La descripción son promedios del CLUSTER, no cifras de este cliente:
          va etiquetada como tal para que el asesor no lea en voz alta el
          promedio del segmento creyendo que es la factura del cliente. */}
      <Panel>
        <TituloPanel icono={<User size={12} />}>Segmento</TituloPanel>
        {cliente.persona ? (
          <>
            <p className="text-sm font-semibold text-acento">
              {cliente.persona.nombre}
            </p>
            <p className="mt-1 text-cuerpo leading-relaxed text-tinta-2">
              {cliente.persona.descripcion}
            </p>
            <p className="mt-1.5 text-etiqueta text-tinta-3 italic">
              Cifras promedio del segmento, no de este cliente.
            </p>
          </>
        ) : (
          <p className="text-cuerpo text-tinta-3">Sin segmento asignado</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1">
          <Badge tono={cliente.es_movistar_total ? "acento" : "neutro"}>
            {etiquetaGap(cliente.gap_a_mt)}
          </Badge>
          <Badge tono={TONO_SALUD[cliente.salud_cliente]}>
            {TEXTO_SALUD[cliente.salud_cliente]}
          </Badge>
          {cliente.es_usuario_app ? <Badge>Usa la app</Badge> : null}
        </div>
      </Panel>

      {/* El hallazgo estrella: lo que factura no es lo que paga. */}
      <Panel className="border-acento-borde">
        <TituloPanel>Lo que paga hoy</TituloPanel>
        <p className="text-2xl font-semibold tracking-tight">
          {soles(cliente.gasto_actual_total)}
          <span className="ml-1 text-sm font-normal text-tinta-3">/mes</span>
        </p>

        {extra > 0.5 ? (
          <p className="mt-1.5 text-cuerpo leading-relaxed text-tinta-2">
            En pantalla su facturación figura como{" "}
            <span className="tabular font-medium">
              {soles(cliente.monto_facturado_prom)}
            </span>
            , pero eso es solo el plan móvil. Paga{" "}
            <span className="tabular font-semibold text-tinta">
              {soles(extra)}
            </span>{" "}
            más por el hogar.
          </p>
        ) : null}

        <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-borde pt-3">
          <Dato
            etiqueta="Plan móvil"
            valor={cliente.plan_actual_nombre ?? "—"}
          />
          <Dato
            etiqueta="Paquete hogar"
            valor={cliente.oferta_hogar_nombre ?? "No tiene"}
          />
        </dl>
      </Panel>

      {/* Datos duros */}
      <Panel>
        <TituloPanel>Cuenta</TituloPanel>
        <dl className="grid grid-cols-2 gap-3">
          <Dato
            etiqueta="Tipo"
            valor={cliente.tipo_cliente ?? "Sin línea móvil"}
          />
          <Dato
            etiqueta="Antigüedad"
            valor={numero(cliente.antiguedad_meses)}
            sufijo="meses"
          />
          <Dato etiqueta="Departamento" valor={cliente.departamento} />
          <Dato etiqueta="Edad" valor={cliente.edad_rango} sufijo="años" />
          <Dato
            etiqueta="Canal que más usa"
            valor={cliente.canal_mas_usado ?? "Sin actividad"}
          />
          <Dato
            etiqueta="Interacciones (6m)"
            valor={numero(cliente.n_actividad_canal)}
          />
        </dl>

        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borde pt-3">
          <div className="flex items-start gap-2">
            <Smartphone size={14} className="mt-0.5 shrink-0 text-tinta-3" />
            <Dato
              etiqueta="Consumo de datos"
              valor={cliente.consumo_datos_gb_prom.toFixed(1)}
              sufijo="GB/mes"
            />
          </div>
          <div className="flex items-start gap-2">
            <Wifi size={14} className="mt-0.5 shrink-0 text-tinta-3" />
            <Dato
              etiqueta="Uso del plan"
              valor={
                cliente.presion_datos === null
                  ? "Ilimitado"
                  : `${Math.round(cliente.presion_datos * 100)}%`
              }
            />
          </div>
        </div>

        {/* Solo se muestran fricciones si existen: llenar de ceros la pantalla
            de un cliente sano es ruido. */}
        {cliente.meses_moroso > 0 || cliente.n_reclamos > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-borde pt-3">
            {cliente.meses_moroso > 0 ? (
              <Badge tono="aviso" icono={<TriangleAlert size={10} />}>
                {cliente.meses_moroso} de 6 meses con mora
                {cliente.dias_mora_prom > 0
                  ? ` · ${Math.round(cliente.dias_mora_prom)} días prom.`
                  : ""}
              </Badge>
            ) : null}
            {cliente.n_reclamos > 0 ? (
              <Badge tono="aviso">
                {cliente.n_reclamos}{" "}
                {cliente.n_reclamos === 1 ? "reclamo" : "reclamos"} en 6 meses
              </Badge>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
