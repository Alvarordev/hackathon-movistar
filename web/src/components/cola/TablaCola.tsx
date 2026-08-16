import Link from "next/link";
import { ChevronRight, Route, Shield, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/Base";
import { etiquetaGap, pct, soles } from "@/lib/api";
import type { ClientePrioridad } from "@/lib/tipos";

/**
 * Bandeja de trabajo. Cada fila tiene que responder en un vistazo: quién es,
 * qué le ofrezco, cuánto vale y por qué está arriba.
 *
 * El valor esperado NO se muestra como decimal crudo: a un asesor "0.4317" no
 * le dice nada. Se traduce a la probabilidad de aceptación, que es la cifra
 * que él entiende y puede repetir.
 */
export function TablaCola({ clientes }: { clientes: ClientePrioridad[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto scroll-fino rounded-panel border border-borde bg-superficie">
      <table className="w-full border-collapse text-cuerpo">
        <thead className="sticky top-0 z-10 bg-superficie-2 text-left">
          <tr className="border-b border-borde">
            <Th className="w-8 text-center">#</Th>
            <Th>Cliente</Th>
            <Th>Perfil</Th>
            <Th>Oferta recomendada</Th>
            <Th className="text-right">Aceptación</Th>
            <Th className="text-right">Ahorro</Th>
            <Th>Canal</Th>
            <Th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {clientes.map((c, i) => (
            <tr
              key={c.cliente_id}
              className="group border-b border-borde last:border-0 hover:bg-acento-suave/40"
            >
              <Td className="text-center text-tinta-3 tabular">{i + 1}</Td>

              <Td>
                <Link
                  href={`/clientes/${c.cliente_id}`}
                  className="font-medium text-tinta hover:text-acento hover:underline"
                >
                  {c.cliente_id}
                </Link>
                {c.nunca_ofrecido_mt ? (
                  <div className="mt-1">
                    <Badge tono="aviso" icono={<Sparkles size={10} />}>
                      Nunca se le ofreció MT
                    </Badge>
                  </div>
                ) : null}
              </Td>

              <Td>
                <div className="text-tinta-2">{c.persona ?? "—"}</div>
                <div className="mt-0.5 text-etiqueta text-tinta-3">
                  {etiquetaGap(c.gap_a_mt)}
                </div>
              </Td>

              <Td>
                <div className="flex items-center gap-1.5">
                  <span className="text-tinta">{c.nombre_oferta}</span>
                  {c.avanza_a_mt ? (
                    <Badge
                      tono="acento"
                      icono={<Shield size={10} />}
                      title="Esta oferta acerca al cliente a Movistar Total"
                    >
                      Blindaje
                    </Badge>
                  ) : null}
                </div>
                {c.tiene_ruta_mt ? (
                  <div className="mt-1 flex items-center gap-1 text-etiqueta text-tinta-3">
                    <Route size={11} />
                    Paso 1 de la ruta a MT
                    {c.ahorro_soles_proyectado !== null ? (
                      <>· ahorro proyectado {soles(c.ahorro_soles_proyectado)}</>
                    ) : null}
                  </div>
                ) : null}
              </Td>

              <Td className="tabular text-right font-semibold">
                {pct(c.prob_aceptacion)}
              </Td>

              <Td className="tabular text-right">
                {c.ahorro_soles === null ? (
                  <span className="text-tinta-3">—</span>
                ) : c.ahorro_soles > 0 ? (
                  <span className="font-semibold text-exito">
                    {soles(c.ahorro_soles)}
                  </span>
                ) : (
                  <span className="text-tinta-3">
                    +{soles(c.ahorro_soles)}
                  </span>
                )}
              </Td>

              <Td className="text-tinta-2">{c.canal_sugerido}</Td>

              <Td>
                <Link
                  href={`/clientes/${c.cliente_id}`}
                  aria-label={`Atender a ${c.cliente_id}`}
                  className="grid size-6 place-items-center rounded text-tinta-3 group-hover:bg-acento group-hover:text-superficie"
                >
                  <ChevronRight size={14} />
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}
