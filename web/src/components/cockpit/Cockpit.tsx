"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";

import { Alternativas } from "./Alternativas";
import { CardOferta } from "./CardOferta";
import { FichaCliente } from "./FichaCliente";
import { Objeciones } from "./Objeciones";
import { RutaMt } from "./RutaMt";
import { Timeline } from "./Timeline";
import { useCopiloto } from "@/components/copiloto/CopilotoProvider";
import { Panel, Vacio } from "@/components/ui/Base";
import { Segmentado } from "@/components/ui/Button";
import {
  CANALES,
  type Canal,
  type Cliente,
  type Journey,
  type Nbo,
} from "@/lib/tipos";

interface Props {
  cliente: Cliente;
  journey: Journey | null;
  nboInicial: Nbo;
}

const OPCIONES_CANAL: { valor: Canal | "sugerido"; etiqueta: string }[] = [
  { valor: "sugerido", etiqueta: "Sugerido" },
  ...CANALES.map((c) => ({ valor: c, etiqueta: c })),
];

/**
 * Cockpit de atención: una sola pantalla, dos zonas con scroll propio.
 *
 * La restricción de UX que manda acá es que el asesor tiene al cliente en la
 * línea: no puede navegar ni perder contexto. Por eso nada abre en otra
 * página. El copiloto ya no es una columna sino una capa flotante sobre esta
 * pantalla —así es como se va a integrar sobre el sistema del call center— y
 * el cockpit solo le informa a quién está atendiendo.
 */
export function Cockpit({ cliente, journey, nboInicial }: Props) {
  const [canal, setCanal] = useState<Canal | null>(null);
  const [nbo, setNbo] = useState<Nbo>(nboInicial);
  const [cargando, setCargando] = useState(false);
  const { preguntar, registrarCliente, liberarCliente, abierto } =
    useCopiloto();

  // Simulador de canal: "el cliente ya está en tienda". Re-rankea con las
  // probabilidades de ese canal, que vienen precalculadas.
  useEffect(() => {
    if (canal === null) {
      setNbo(nboInicial);
      return;
    }
    let vigente = true;
    setCargando(true);
    fetch(
      `/api/clientes/${cliente.cliente_id}/nbo?canal=${encodeURIComponent(canal)}`,
    )
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

  // El copiloto vive en el layout: hay que decirle a quién estamos atendiendo
  // y en qué situación está, que es lo que decide sus atajos y su tono.
  useEffect(() => {
    registrarCliente(cliente.cliente_id, {
      abstenerse: nbo.abstenerse,
      tieneRutaMt: nbo.ruta_mt !== null,
    });
  }, [cliente.cliente_id, nbo.abstenerse, nbo.ruta_mt, registrarCliente]);

  useEffect(() => () => liberarCliente(), [liberarCliente]);

  const [principal, ...resto] = nbo.recomendaciones;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-borde bg-superficie px-4 py-2">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-cuerpo font-medium text-tinta-2 transition-colors hover:bg-superficie-2"
        >
          <ArrowLeft size={14} />
          Cola
        </Link>

        <span className="text-sm font-semibold">{cliente.cliente_id}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-etiqueta text-tinta-3">Atendiendo por</span>
          <Segmentado
            etiquetaGrupo="Canal de atención"
            opciones={OPCIONES_CANAL}
            valor={canal ?? "sugerido"}
            onCambiar={(v) => setCanal(v === "sugerido" ? null : (v as Canal))}
            tam="sm"
          />
          {cargando ? (
            <Loader2 size={14} className="animate-spin text-tinta-3" />
          ) : null}
        </div>
      </div>

      {/* Con el panel abierto el contenido se corre en pantallas anchas: el
          copiloto se siente acoplado y no tapa la oferta. Por debajo de xl
          simplemente flota encima, que es lo que corresponde cuando no hay
          ancho para las dos cosas. */}
      <div
        className={`grid min-h-0 flex-1 gap-3 p-3 transition-[margin] duration-[250ms] ease-drawer lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] ${
          abierto ? "xl:mr-[424px]" : ""
        }`}
      >
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
              <p className="mx-auto max-w-md text-center text-dato leading-relaxed text-tinta-3">
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
      </div>
    </div>
  );
}
