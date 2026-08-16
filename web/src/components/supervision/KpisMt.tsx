import { Panel, TituloPanel } from "@/components/ui/Base";
import { numero, pct } from "@/lib/api";
import type { Metrics } from "@/lib/tipos";

/**
 * Los indicadores que la ficha del desafío pide mover.
 *
 * Un ratio contra un límite se muestra como medidor, no como torta de dos
 * gajos: la meta es una marca sobre la misma pista, para que la distancia se
 * lea sin hacer aritmética.
 */
export function KpisMt({ metrics }: { metrics: Metrics }) {
  const p = metrics.participacion_mt;
  const m = metrics.mercado_ampliado_mt;
  const c = metrics.cobertura_perdida_mt;

  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <TituloPanel>Participación de Movistar Total en la venta</TituloPanel>
        <div className="flex flex-col gap-4">
          <Medidor
            etiqueta="Venta hogar con MT"
            valor={p.venta_hogar_actual_pct}
            meta={p.meta_hogar_pct}
          />
          <Medidor
            etiqueta="Venta móvil con MT"
            valor={p.venta_movil_actual_pct}
            meta={p.meta_movil_pct}
          />
        </div>
        {/* Si la meta ya está cumplida hay que decirlo y redirigir a dónde
            sigue habiendo terreno, en vez de dibujar una brecha inexistente. */}
        {p.venta_movil_actual_pct >= p.meta_movil_pct ||
        p.venta_hogar_actual_pct >= p.meta_hogar_pct ? (
          <p className="mt-3 rounded-md border border-exito-borde bg-exito-suave px-3 py-2 text-dato leading-relaxed text-tinta-2">
            En el histórico de estas campañas MT ya supera la meta móvil. El
            terreno que queda no está en convertir mejor a quien ya es
            elegible, sino en <span className="font-semibold">a quién se le
            puede ofrecer</span>: la cobertura perdida y el mercado alcanzable
            de abajo.
          </p>
        ) : null}

        <p className="mt-3 border-t border-borde pt-2.5 text-etiqueta leading-relaxed text-tinta-3">
          {p.definicion}
        </p>
      </Panel>

      <Panel>
        <TituloPanel>Mercado alcanzable para MT</TituloPanel>
        {/* Cifra protagonista: figuras proporcionales, no tabulares. */}
        <p className="text-4xl font-semibold tracking-tight">
          {numero(m.total_alcanzable)}
        </p>
        <p className="mt-1 text-cuerpo leading-relaxed text-tinta-2">
          clientes, contra los{" "}
          <span className="font-semibold">{numero(m.ya_elegibles)}</span> que
          marca la columna <code className="text-dato">elegible_mt</code>.
          Derivar qué producto le falta a cada uno multiplica el mercado por{" "}
          <span className="font-semibold text-acento">
            {m.multiplicador_vs_columna_cruda}
          </span>
          .
        </p>

        <ul className="mt-3 flex flex-col gap-1.5 border-t border-borde pt-3">
          <FilaGap
            etiqueta="Ya elegibles"
            n={m.ya_elegibles}
            total={m.total_alcanzable}
            destacado
          />
          <FilaGap
            etiqueta="Les falta un producto hogar"
            n={m.desglose_gap.producto_hogar ?? 0}
            total={m.total_alcanzable}
          />
          <FilaGap
            etiqueta="Les falta migrar a postpago"
            n={m.desglose_gap.migracion_postpago ?? 0}
            total={m.total_alcanzable}
          />
          <FilaGap
            etiqueta="Les falta internet hogar"
            n={m.desglose_gap.internet_hogar ?? 0}
            total={m.total_alcanzable}
          />
        </ul>
      </Panel>

      <Panel className="border-aviso-borde">
        <TituloPanel>Cobertura perdida</TituloPanel>
        <p className="text-4xl font-semibold tracking-tight text-aviso">
          {numero(c.nunca_ofertados_mt)}
        </p>
        <p className="mt-1 text-cuerpo leading-relaxed text-tinta-2">
          clientes elegibles a Movistar Total a los que{" "}
          <span className="font-semibold">nunca</span> se les ofreció —{" "}
          {pct(c.pct, 1)} de los {numero(c.clientes_elegibles)} elegibles. Es
          venta perdida sin necesidad de convencer a nadie: solo hay que
          ofrecerla.
        </p>
      </Panel>
    </div>
  );
}

function Medidor({
  etiqueta,
  valor,
  meta,
}: {
  etiqueta: string;
  valor: number;
  meta: number;
}) {
  const alcanzada = valor >= meta;
  // La pista llega hasta la meta o hasta el valor, lo que sea mayor: si ya se
  // superó la meta, comprimir la barra al 100% escondería por cuánto.
  const escala = Math.max(meta, valor) * 1.15;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-cuerpo text-tinta-2">{etiqueta}</span>
        <span className="flex items-baseline gap-1.5">
          <span
            className={`tabular text-base font-semibold ${
              alcanzada ? "text-exito" : "text-tinta"
            }`}
          >
            {pct(valor, 1)}
          </span>
          <span className="text-etiqueta text-tinta-3">
            meta {pct(meta)}
          </span>
        </span>
      </div>

      <div className="relative h-2.5 w-full rounded-full bg-superficie-2">
        <div
          className={`h-full rounded-full ${alcanzada ? "bg-exito" : "bg-acento"}`}
          style={{ width: `${Math.min(100, (valor / escala) * 100)}%` }}
        />
        {/* La meta es una marca sobre la pista, no otra barra que competir. */}
        <div
          className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded bg-tinta"
          style={{ left: `${Math.min(100, (meta / escala) * 100)}%` }}
          role="img"
          aria-label={`Meta: ${pct(meta)}`}
        />
      </div>
    </div>
  );
}

function FilaGap({
  etiqueta,
  n,
  total,
  destacado,
}: {
  etiqueta: string;
  n: number;
  total: number;
  destacado?: boolean;
}) {
  return (
    <li>
      <div className="mb-0.5 flex items-baseline justify-between gap-2 text-cuerpo">
        <span className="text-tinta-2">{etiqueta}</span>
        <span className="tabular font-medium">{numero(n)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-superficie-2">
        <div
          className={`h-full rounded-full ${
            destacado ? "bg-acento" : "bg-acento/40"
          }`}
          style={{ width: `${Math.max(1, (n / total) * 100)}%` }}
        />
      </div>
    </li>
  );
}
