import {
  Check,
  FileAudio,
  FileText,
  History,
  MessageSquare,
  PhoneOff,
  X,
} from "lucide-react";

import { Badge, Panel, TituloPanel, Vacio } from "@/components/ui/Base";
import { etiquetaMotivo, fecha } from "@/lib/api";
import type { Journey } from "@/lib/tipos";

const ICONO_PRUEBA = {
  registro_plataforma: FileText,
  audio_llamada: FileAudio,
  chat_log: MessageSquare,
} as const;

const ETIQUETA_PRUEBA: Record<string, string> = {
  registro_plataforma: "Registro de plataforma",
  audio_llamada: "Audio de llamada",
  chat_log: "Log de chat",
};

/**
 * Línea de tiempo del cliente.
 *
 * Le evita al asesor el error más caro: reofrecer lo que ya fue rechazado sin
 * cambiar el argumento. Cada evento muestra su medio probatorio, que es la
 * parte de trazabilidad E2E que la ficha del desafío pide.
 */
export function Timeline({ journey }: { journey: Journey }) {
  const { resumen, eventos } = journey;

  return (
    <Panel>
      <TituloPanel icono={<History size={12} />}>
        Historial del cliente
      </TituloPanel>

      {eventos.length === 0 ? (
        <Vacio
          titulo="Sin ofrecimientos previos"
          detalle="Es la primera vez que se le contacta con una oferta."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1">
            <Badge>{resumen.n_ofrecimientos} ofrecimientos</Badge>
            {resumen.n_aceptados > 0 ? (
              <Badge tono="exito">{resumen.n_aceptados} aceptados</Badge>
            ) : null}
            {resumen.n_rechazados > 0 ? (
              <Badge tono="alerta">{resumen.n_rechazados} rechazados</Badge>
            ) : null}
            {resumen.n_no_contactado > 0 ? (
              <Badge>{resumen.n_no_contactado} sin contactar</Badge>
            ) : null}
            {resumen.nunca_ofrecido_mt ? (
              <Badge tono="aviso">Nunca se le ofreció MT</Badge>
            ) : (
              <Badge tono="acento">
                MT ofrecido {resumen.veces_ofrecido_mt}×
              </Badge>
            )}
          </div>

          {resumen.motivo_rechazo_dominante ? (
            <p className="mb-3 rounded-md border border-aviso-borde bg-aviso-suave px-2.5 py-1.5 text-[12px] text-tinta-2">
              Cuando rechaza, suele ser por:{" "}
              <span className="font-semibold">
                {etiquetaMotivo(resumen.motivo_rechazo_dominante)}
              </span>
            </p>
          ) : null}

          <ol className="relative flex flex-col gap-3 border-l border-borde pl-4">
            {[...eventos].reverse().map((e) => {
              const noContactado = e.contactabilidad === "no_contactado";
              const IconoPrueba = e.medio_probatorio
                ? ICONO_PRUEBA[e.medio_probatorio as keyof typeof ICONO_PRUEBA]
                : null;

              return (
                <li key={e.ofrecimiento_id} className="relative">
                  <span
                    aria-hidden
                    className={`absolute top-1 -left-[21px] grid size-3.5 place-items-center rounded-full border-2 border-superficie ${
                      noContactado
                        ? "bg-tinta-3"
                        : e.resultado === "aceptada"
                          ? "bg-exito"
                          : "bg-alerta"
                    }`}
                  >
                    {noContactado ? (
                      <PhoneOff size={7} className="text-superficie" />
                    ) : e.resultado === "aceptada" ? (
                      <Check size={8} className="text-superficie" />
                    ) : (
                      <X size={8} className="text-superficie" />
                    )}
                  </span>

                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">
                      {e.nombre_oferta}
                    </span>
                    <span className="shrink-0 text-[11px] text-tinta-3">
                      {fecha(e.fecha)}
                    </span>
                  </div>

                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-tinta-3">
                    <span>{e.canal}</span>
                    {e.oferta_es_mt ? (
                      <Badge tono="acento">MT</Badge>
                    ) : null}
                    {noContactado ? (
                      <span className="text-tinta-3">No se le pudo contactar</span>
                    ) : e.resultado === "rechazada" && e.motivo_rechazo ? (
                      <span className="font-medium text-alerta">
                        Rechazó: {etiquetaMotivo(e.motivo_rechazo)}
                      </span>
                    ) : e.resultado === "aceptada" ? (
                      <span className="font-medium text-exito">Aceptó</span>
                    ) : null}
                    {IconoPrueba && e.medio_probatorio ? (
                      <span
                        className="ml-auto flex items-center gap-1"
                        title={`Medio probatorio: ${
                          ETIQUETA_PRUEBA[e.medio_probatorio]
                        }`}
                      >
                        <IconoPrueba size={11} />
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Panel>
  );
}
