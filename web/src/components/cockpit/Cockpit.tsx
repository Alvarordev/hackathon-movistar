"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";

import { Alternativas } from "./Alternativas";
import { CardOferta } from "./CardOferta";
import { Copiloto, type CopilotoHandle } from "./Copiloto";
import { FichaCliente } from "./FichaCliente";
import { Objeciones } from "./Objeciones";
import { RutaMt } from "./RutaMt";
import { Timeline } from "./Timeline";
import { Panel, Vacio } from "@/components/ui/Base";
import { CANALES, type Canal, type Cliente, type Journey, type Nbo } from "@/lib/tipos";

interface Props {
  cliente: Cliente;
  journey: Journey | null;
  nboInicial: Nbo;
}

/**
 * Cockpit de atención: una sola pantalla, tres zonas con scroll propio.
 *
 * La restricción de UX que manda acá es que el asesor tiene al cliente en la
 * línea: no puede navegar ni perder contexto. Por eso nada abre en otra
 * página y el copiloto está siempre visible, no detrás de un botón.
 */
export function Cockpit({ cliente, journey, nboInicial }: Props) {
  const [canal, setCanal] = useState<Canal | null>(null);
  const [nbo, setNbo] = useState<Nbo>(nboInicial);
  const [cargando, setCargando] = useState(false);
  const copilotoRef = useRef<CopilotoHandle>(null);

  // Simulador de canal: "el cliente ya está en tienda". Re-rankea con las
  // probabilidades de ese canal, que vienen precalculadas.
  useEffect(() => {
    if (canal === null) {
      setNbo(nboInicial);
      return;
    }
    let vigente = true;
    setCargando(true);
    fetch(`/api/clientes/${cliente.cliente_id}/nbo?canal=${encodeURIComponent(canal)}`)
      .then((r) => r.json())
      .then((d) => {
        if (vigente) setNbo(d);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [canal, cliente.cliente_id, nboInicial]);

  const preguntar = useCallback((texto: string) => {
    copilotoRef.current?.preguntar(texto);
  }, []);

  const [principal, ...resto] = nbo.recomendaciones;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-borde bg-superficie px-4 py-2">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-tinta-2 hover:bg-superficie-2"
        >
          <ArrowLeft size={14} />
          Cola
        </Link>

        <span className="text-sm font-semibold">{cliente.cliente_id}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-tinta-3">Atendiendo por</span>
          <div className="flex items-center gap-0.5 rounded-md border border-borde bg-superficie p-0.5">
            <BotonCanal activo={canal === null} onClick={() => setCanal(null)}>
              Sugerido
            </BotonCanal>
            {CANALES.map((c) => (
              <BotonCanal
                key={c}
                activo={canal === c}
                onClick={() => setCanal(c)}
              >
                {c}
              </BotonCanal>
            ))}
          </div>
          {cargando ? (
            <Loader2 size={14} className="animate-spin text-tinta-3" />
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,340px)]">
        <div className="min-h-0 overflow-y-auto scroll-fino">
          <FichaCliente cliente={cliente} />
          {journey ? (
            <div className="mt-3">
              <Timeline journey={journey} />
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto scroll-fino">
          {nbo.abstenerse ? (
            <Panel className="border-alerta-borde">
              <Vacio
                icono={<ShieldAlert size={26} className="text-alerta" />}
                titulo="Este cliente no es candidato a venta"
                detalle={
                  nbo.motivo_abstencion ??
                  "Tiene alertas que desaconsejan un ofrecimiento comercial."
                }
              />
              <p className="mx-auto max-w-md text-center text-[12px] leading-relaxed text-tinta-3">
                El motor se abstiene a propósito: ofrecerle un producto ahora
                deteriora la relación y la probabilidad de cobro. Corresponde
                derivar a retención o cobranza.
              </p>
            </Panel>
          ) : principal ? (
            <>
              <CardOferta rec={principal} />
              {nbo.ruta_mt ? <RutaMt ruta={nbo.ruta_mt} /> : null}
              <Objeciones onPedirSpeech={(_, texto) => preguntar(texto)} />
              <Alternativas recomendaciones={resto} onPreguntar={preguntar} />
            </>
          ) : (
            <Panel>
              <Vacio
                titulo="Sin recomendaciones disponibles"
                detalle="No hay ofertas elegibles para este cliente en el catálogo actual."
              />
            </Panel>
          )}
        </div>

        <div className="min-h-0">
          <Copiloto
            ref={copilotoRef}
            clienteId={cliente.cliente_id}
            estado={{
              abstenerse: nbo.abstenerse,
              tieneRutaMt: nbo.ruta_mt !== null,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function BotonCanal({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded px-2 py-1 text-[12px] font-medium transition-colors ${
        activo
          ? "bg-acento-suave text-acento"
          : "text-tinta-2 hover:bg-superficie-2"
      }`}
    >
      {children}
    </button>
  );
}
