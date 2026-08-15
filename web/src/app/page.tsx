import { AlertTriangle, Inbox } from "lucide-react";

import { FiltrosCola } from "@/components/cola/FiltrosCola";
import { TablaCola } from "@/components/cola/TablaCola";
import { Panel, Vacio } from "@/components/ui/Base";
import { api, numero } from "@/lib/api";
import { CANALES } from "@/lib/tipos";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ColaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const foco = sp.foco === "todos" ? "todos" : "mt";
  const canal = CANALES.includes(sp.canal as never) ? sp.canal : undefined;
  const soloNunca = sp.solo_nunca_ofertados === "true";

  let datos = null;
  let error: string | null = null;
  try {
    datos = await api.prioridades({
      foco,
      canal,
      solo_nunca_ofertados: soloNunca,
      limit: 50,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Cola de atención
          </h1>
          <p className="mt-0.5 text-[13px] text-tinta-2">
            Clientes ordenados por valor esperado de la mejor oportunidad.
            Quienes tienen alerta de retención no aparecen acá.
          </p>
        </div>
        {datos ? (
          <p className="tabular text-[13px] text-tinta-3">
            {numero(datos.n)} clientes priorizados
          </p>
        ) : null}
      </header>

      <FiltrosCola
        foco={foco}
        canal={canal}
        soloNunca={soloNunca}
      />

      {error ? (
        <Panel>
          <Vacio
            icono={<AlertTriangle size={22} />}
            titulo="No se pudo cargar la cola"
            detalle={error}
          />
        </Panel>
      ) : datos && datos.clientes.length > 0 ? (
        <TablaCola clientes={datos.clientes} />
      ) : (
        <Panel>
          <Vacio
            icono={<Inbox size={22} />}
            titulo="No hay clientes con estos filtros"
            detalle="Prueba quitando el filtro de canal o cambiando el foco a todo el portafolio."
          />
        </Panel>
      )}
    </div>
  );
}
