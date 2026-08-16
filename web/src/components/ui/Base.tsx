import type { ReactNode } from "react";

type Tono = "neutro" | "acento" | "exito" | "alerta" | "aviso";

const TONO_BADGE: Record<Tono, string> = {
  neutro: "bg-superficie-2 text-tinta-2 border-borde",
  acento: "bg-acento-suave text-acento border-acento-borde",
  exito: "bg-exito-suave text-exito border-exito-borde",
  alerta: "bg-alerta-suave text-alerta border-alerta-borde",
  aviso: "bg-aviso-suave text-aviso border-aviso-borde",
};

export function Badge({
  children,
  tono = "neutro",
  icono,
  title,
}: {
  children: ReactNode;
  tono?: Tono;
  icono?: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-etiqueta font-medium whitespace-nowrap ${TONO_BADGE[tono]}`}
    >
      {icono}
      {children}
    </span>
  );
}

export function Panel({
  children,
  className = "",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <section
      className={`rounded-panel border border-borde bg-superficie shadow-panel ${
        padding ? "p-4" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function TituloPanel({
  children,
  icono,
  accion,
}: {
  children: ReactNode;
  icono?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-etiqueta font-semibold tracking-wider text-tinta-3 uppercase">
        {icono}
        {children}
      </h2>
      {accion}
    </div>
  );
}

/** Par etiqueta/valor. La unidad va aparte y en gris: el número manda. */
export function Dato({
  etiqueta,
  valor,
  sufijo,
  tono,
}: {
  etiqueta: string;
  valor: ReactNode;
  sufijo?: string;
  tono?: "exito" | "alerta";
}) {
  const color =
    tono === "exito"
      ? "text-exito"
      : tono === "alerta"
        ? "text-alerta"
        : "text-tinta";
  return (
    <div className="min-w-0">
      <dt className="truncate text-etiqueta text-tinta-3">{etiqueta}</dt>
      <dd className={`tabular truncate text-sm font-semibold ${color}`}>
        {valor}
        {sufijo ? (
          <span className="ml-0.5 text-xs font-normal text-tinta-3">
            {sufijo}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Barra de probabilidad. Lleva el número al lado siempre: una barra sin cifra
 * obliga a estimar, y el asesor va a decir el número en voz alta.
 */
export function BarraProb({
  valor,
  etiqueta,
  tono = "acento",
}: {
  valor: number;
  etiqueta?: string;
  tono?: "acento" | "exito";
}) {
  const pct = Math.round(valor * 100);
  return (
    <div>
      {etiqueta ? (
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-etiqueta text-tinta-3">{etiqueta}</span>
          <span className="tabular text-sm font-semibold">{pct}%</span>
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-superficie-2"
        role="img"
        aria-label={`${etiqueta ?? "Probabilidad"}: ${pct} por ciento`}
      >
        <div
          className={`h-full rounded-full ${
            tono === "exito" ? "bg-exito" : "bg-acento"
          }`}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

export function Vacio({
  titulo,
  detalle,
  icono,
}: {
  titulo: string;
  detalle?: string;
  icono?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icono ? <div className="text-tinta-3">{icono}</div> : null}
      <p className="text-sm font-medium text-tinta-2">{titulo}</p>
      {detalle ? (
        <p className="max-w-sm text-xs text-tinta-3">{detalle}</p>
      ) : null}
    </div>
  );
}

/** Marca de dónde sale un dato (modelo vs regla). Es un compromiso del
 *  proyecto mostrarlo, no esconderlo. */
export function Origen({ children }: { children: ReactNode }) {
  return (
    <span className="text-etiqueta text-tinta-3 italic">{children}</span>
  );
}
