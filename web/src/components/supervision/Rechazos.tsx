import { Panel, TituloPanel } from "@/components/ui/Base";
import { etiquetaMotivo, numero, pct } from "@/lib/api";
import type { Funnel } from "@/lib/tipos";

/**
 * Por qué se pierden las ventas.
 *
 * Los motivos son categorías nominales: no tienen orden natural, así que van
 * TODAS del mismo color. Pintarlas con una rampa según su tamaño duplicaría en
 * el color lo que ya dice el largo de la barra, y gastaría el único canal
 * libre en información redundante.
 */
export function Rechazos({ funnel }: { funnel: Funnel }) {
  const entradas = Object.entries(funnel.rechazos_por_motivo).sort(
    (a, b) => b[1] - a[1],
  );
  const total = entradas.reduce((s, [, v]) => s + v, 0);
  const tope = entradas[0]?.[1] || 1;

  return (
    <Panel>
      <TituloPanel>Por qué rechazan</TituloPanel>

      <ul className="flex flex-col gap-2.5">
        {entradas.map(([motivo, n]) => (
          <li key={motivo}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="text-cuerpo text-tinta-2">
                {etiquetaMotivo(motivo)}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="tabular text-cuerpo font-medium">
                  {numero(n)}
                </span>
                <span className="tabular w-10 text-right text-etiqueta text-tinta-3">
                  {pct(n / total, 1)}
                </span>
              </span>
            </div>
            <div
              className="h-2 w-full rounded-r-[4px] bg-superficie-2"
              role="img"
              aria-label={`${etiquetaMotivo(motivo)}: ${numero(n)} rechazos`}
            >
              <div
                className="h-full rounded-r-[4px] bg-acento"
                style={{ width: `${Math.max(1.5, (n / tope) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-borde pt-2.5 text-dato leading-relaxed text-tinta-3">
        El precio domina, pero en el historial bajar el precio recupera menos
        que pivotar a Movistar Total. La matriz de rebate del cockpit muestra la
        palanca que corresponde a cada motivo.
      </p>
    </Panel>
  );
}
