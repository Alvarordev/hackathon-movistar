import { AlertTriangle } from "lucide-react";

import { Funnel } from "@/components/supervision/Funnel";
import { IndicadoresFicha } from "@/components/supervision/IndicadoresFicha";
import { KpisMt } from "@/components/supervision/KpisMt";
import { Modelo } from "@/components/supervision/Modelo";
import { Rechazos } from "@/components/supervision/Rechazos";
import { Panel, Vacio } from "@/components/ui/Base";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SupervisionPage() {
  let funnel = null;
  let metrics = null;
  let error: string | null = null;

  try {
    [funnel, metrics] = await Promise.all([api.funnel(), api.metrics()]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error || !funnel || !metrics) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Panel>
          <Vacio
            icono={<AlertTriangle size={22} />}
            titulo="No se pudieron cargar las métricas"
            detalle={
              error ?? "Ejecuta el pipeline y el seed para generar los artefactos."
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-fino">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
        <header>
          <h1 className="text-lg font-semibold tracking-tight">Supervisión</h1>
          <p className="mt-0.5 max-w-3xl text-cuerpo leading-relaxed text-tinta-2">
            Seguimiento de extremo a extremo del ofrecimiento y avance sobre los
            indicadores de Movistar Total.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <Funnel inicial={funnel} />
            <Rechazos funnel={funnel} />
          </div>
          <KpisMt metrics={metrics} />
        </div>

        <IndicadoresFicha metrics={metrics} />

        <Modelo metrics={metrics} />
      </div>
    </div>
  );
}
