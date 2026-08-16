import { Info } from "lucide-react";

import { Panel, TituloPanel } from "@/components/ui/Base";
import { numero } from "@/lib/api";
import type { Metrics } from "@/lib/tipos";

/**
 * Transparencia del modelo.
 *
 * Va en la pantalla, no en un anexo: en telecomunicaciones el ofrecimiento
 * queda registrado con medio probatorio, y un supervisor tiene que poder
 * responder de dónde salen las probabilidades que ve el asesor. Se muestran
 * también los límites, no solo los aciertos.
 */
export function Modelo({ metrics }: { metrics: Metrics }) {
  const a = metrics.modelo_aceptacion;
  const b = metrics.modelo_contactabilidad;

  return (
    <Panel>
      <TituloPanel icono={<Info size={12} />}>
        Cómo se calcula la recomendación
      </TituloPanel>

      <p className="mb-3 text-cuerpo leading-relaxed text-tinta-2">
        El modelo decide y es auditable; el copiloto explica. Las
        probabilidades salen de un modelo entrenado sobre{" "}
        {numero(a.n_train + a.n_valid + a.n_test)} ofrecimientos reales, con
        corte temporal: se entrena con el pasado y se evalúa contra meses que
        nunca vio.
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-borde pt-3 text-cuerpo sm:grid-cols-4">
        <Metrica
          etiqueta="AUC de prueba"
          valor={a.auc_test.toFixed(3)}
          nota="modelo completo"
        />
        <Metrica
          etiqueta="Regla de 1 variable"
          valor={(a.auc_baseline_solo_mt ?? 0).toFixed(3)}
          nota="solo '¿es MT?'"
        />
        <Metrica
          etiqueta="Lift del decil top"
          valor={`${a.lift_decil_superior}×`}
          nota="vs. llamar al azar"
        />
        <Metrica
          etiqueta="Evaluado desde"
          valor={a.split.test_desde ?? "—"}
          nota="corte temporal"
        />
      </dl>

      <div className="mt-3 flex flex-col gap-2 border-t border-borde pt-3">
        <Nota titulo="El techo de estos datos es bajo, y se reporta">
          Una regla de una sola variable ya alcanza{" "}
          {(a.auc_baseline_solo_mt ?? 0).toFixed(3)}; el modelo con{" "}
          {a.n_features} variables llega a {a.auc_test.toFixed(3)}. El margen es
          lo que aportan las demás. Un AUC de 0.85 acá sería fuga de
          información, no mérito: el pipeline aborta si supera 0.90.
        </Nota>

        <Nota titulo="La contactabilidad no se puede predecir con estos datos">
          {b.nota} Por eso el canal sugerido sale del canal que más usa el
          cliente y aparece etiquetado como tal en el cockpit, en vez de
          presentarse como una predicción.
        </Nota>
      </div>
    </Panel>
  );
}

function Metrica({
  etiqueta,
  valor,
  nota,
}: {
  etiqueta: string;
  valor: string;
  nota: string;
}) {
  return (
    <div>
      <dt className="text-etiqueta text-tinta-3">{etiqueta}</dt>
      <dd className="text-lg font-semibold tracking-tight">{valor}</dd>
      <p className="text-etiqueta text-tinta-3">{nota}</p>
    </div>
  );
}

function Nota({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-borde bg-superficie-2 px-3 py-2">
      <p className="text-dato font-semibold">{titulo}</p>
      <p className="mt-0.5 text-dato leading-relaxed text-tinta-2">
        {children}
      </p>
    </div>
  );
}
