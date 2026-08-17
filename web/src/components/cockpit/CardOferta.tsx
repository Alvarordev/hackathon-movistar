import { AlertTriangle, History, Radio, Shield, TrendingDown, TrendingUp } from "lucide-react";

import { Badge, BarraProb, Origen } from "@/components/ui/Base";
import { etiquetaOrigen, fecha, pct, soles } from "@/lib/api";
import type { Recomendacion } from "@/lib/tipos";

/**
 * La recomendación #1. Es lo primero que mira el asesor y de acá salen las
 * frases que va a decir en voz alta, así que las cifras van grandes y con su
 * unidad, no como decimales sueltos.
 */
export function CardOferta({ rec }: { rec: Recomendacion }) {
  const esRecordatorio = rec.accion === "recordatorio";
  const ahorra = rec.ahorro_soles !== null && rec.ahorro_soles > 0;
  const cuesta = rec.ahorro_soles !== null && rec.ahorro_soles < 0;
  // `a_favor` viene del signo de la contribución del modelo. Se tolera su
  // ausencia por si la UI corre contra artefactos de un pipeline anterior.
  const aFavor = rec.drivers.filter((d) => d.a_favor !== false);
  const enContra = rec.drivers.filter((d) => d.a_favor === false);

  return (
    <article className="rounded-panel border-2 border-acento-borde bg-superficie">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-borde p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tono={esRecordatorio ? "aviso" : "acento"}>
              {esRecordatorio ? "Seguimiento" : "Recomendación #1"}
            </Badge>
            {rec.avanza_a_mt ? (
              <Badge
                tono="acento"
                icono={<Shield size={10} />}
                title="Esta oferta acerca al cliente a Movistar Total"
              >
                Blindaje MT
              </Badge>
            ) : null}
            {rec.gb_ilimitado ? <Badge>GB ilimitados</Badge> : null}
          </div>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight">
            {rec.nombre_oferta}
          </h2>
          <p className="tabular mt-0.5 text-cuerpo text-tinta-2">
            {soles(rec.precio_mensual)} al mes
            {rec.gb_incluidos ? ` · ${rec.gb_incluidos} GB` : ""}
          </p>
        </div>

        {/* El ahorro es el argumento de venta más fuerte que tenemos: va en
            el tamaño más grande de la pantalla. */}
        {ahorra ? (
          <div className="text-right">
            <p className="text-etiqueta text-tinta-3">Ahorra al mes</p>
            {/* Figuras proporcionales: tabular-nums en una cifra grande
                suelta la deja suelta y desalineada. */}
            <p className="text-3xl font-semibold tracking-tight text-exito">
              {soles(rec.ahorro_soles)}
            </p>
            {rec.ahorro_pct_real ? (
              <p className="text-etiqueta text-tinta-3">
                {pct(rec.ahorro_pct_real)} menos que hoy
              </p>
            ) : null}
          </div>
        ) : cuesta ? (
          <div className="text-right">
            <p className="text-etiqueta text-tinta-3">Costo adicional</p>
            <p className="text-2xl font-semibold tracking-tight text-tinta-2">
              +{soles(rec.ahorro_soles)}
            </p>
            <p className="text-etiqueta text-tinta-3">al mes</p>
          </div>
        ) : null}
      </header>

      {esRecordatorio ? (
        <div className="flex items-start gap-2 border-b border-aviso-borde bg-aviso-suave px-4 py-2.5">
          <History size={14} className="mt-0.5 shrink-0 text-aviso" />
          <p className="text-dato leading-relaxed text-tinta-2">
            Este cliente ya aceptó esta oferta
            {rec.fecha_aceptacion_previa
              ? ` el ${fecha(rec.fecha_aceptacion_previa)}`
              : ""}{" "}
            y la contratación quedó pendiente. Retomar y cerrar, no re-vender.
          </p>
        </div>
      ) : null}

      {rec.es_downgrade_datos ? (
        <div className="flex items-start gap-2 border-b border-alerta-borde bg-alerta-suave px-4 py-2.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-alerta" />
          <p className="text-dato leading-relaxed text-tinta-2">
            Ojo: incluye menos GB de los que el cliente usa hoy
            {rec.gb_incluidos ? ` (${rec.gb_incluidos} GB)` : ""}.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <BarraProb
            valor={rec.prob_aceptacion}
            etiqueta="Probabilidad de aceptación"
            tono="exito"
          />
          <BarraProb
            valor={rec.prob_contacto}
            etiqueta="Probabilidad de contacto"
          />

          <div className="flex items-start gap-2 border-t border-borde pt-3">
            <Radio size={14} className="mt-0.5 shrink-0 text-tinta-3" />
            <div className="min-w-0">
              <p className="text-cuerpo font-medium">{rec.canal_sugerido}</p>
              {etiquetaOrigen(rec.canal_origen) ? (
                <Origen>{etiquetaOrigen(rec.canal_origen)}</Origen>
              ) : null}
            </div>
          </div>

          {rec.momento_sugerido ? (
            <div className="rounded-md border border-aviso-borde bg-aviso-suave px-2.5 py-2">
              <p className="text-dato leading-relaxed text-tinta-2">
                {rec.momento_sugerido}
              </p>
            </div>
          ) : null}

          {rec.n_rechazos_previos > 0 ? (
            <div className="flex items-start gap-2 text-dato text-tinta-3">
              <History size={13} className="mt-0.5 shrink-0" />
              <span>
                Rechazada {rec.n_rechazos_previos}{" "}
                {rec.n_rechazos_previos === 1 ? "vez" : "veces"} antes
                {rec.fecha_ultimo_rechazo
                  ? ` (última: ${fecha(rec.fecha_ultimo_rechazo)})`
                  : ""}{" "}
                — el ranking ya lo descuenta.
              </span>
            </div>
          ) : null}
        </div>

        {/* El modelo pesa factores en los dos sentidos y se muestran los dos.
            Meter una contribución negativa bajo "por qué esta oferta" haría
            que el asesor use como argumento algo que en realidad juega en
            contra. */}
        <div className="flex flex-col gap-3">
          {aFavor.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
                <TrendingUp size={12} />
                Juega a favor
              </p>
              <ul className="flex flex-col gap-2">
                {aFavor.map((d) => (
                  <li
                    key={d.feature}
                    className="flex gap-2 text-cuerpo leading-snug"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-exito"
                    />
                    <span className="text-tinta-2">{d.texto}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {enContra.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
                <TrendingDown size={12} />
                Juega en contra
              </p>
              <ul className="flex flex-col gap-2">
                {enContra.map((d) => (
                  <li
                    key={d.feature}
                    className="flex gap-2 text-cuerpo leading-snug"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-tinta-3"
                    />
                    <span className="text-tinta-3">{d.texto}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
