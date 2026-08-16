import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Botón y control segmentado.
 *
 * Existen porque el mismo par de estilos estaba reescrito a mano en cinco
 * archivos, con hovers que ya no coincidían entre sí. Lo que aportan además de
 * consistencia son los dos detalles que ningún duplicado tenía: el `scale` al
 * presionar —sin él la interfaz no acusa recibo del click— y un anillo de foco
 * propio, que es lo único que ve quien navega con teclado.
 */

type Variante = "primario" | "outline" | "ghost";
type Tam = "md" | "sm";

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium " +
  "select-none outline-none " +
  "transition-[transform,background-color,border-color,color,opacity] " +
  "duration-150 ease-fuerte active:scale-[0.97] " +
  "focus-visible:ring-2 focus-visible:ring-acento/40 focus-visible:ring-offset-1 " +
  "disabled:pointer-events-none disabled:opacity-40 " +
  "motion-reduce:transition-none motion-reduce:active:scale-100";

const VARIANTE: Record<Variante, string> = {
  primario: "bg-acento text-white hover:bg-acento/90",
  outline:
    "border border-borde bg-superficie text-tinta-2 " +
    "hover:border-borde-fuerte hover:bg-superficie-2 hover:text-tinta",
  ghost: "text-tinta-2 hover:bg-superficie-2 hover:text-tinta",
};

const TAM: Record<Tam, string> = {
  md: "px-2.5 py-1.5 text-cuerpo",
  sm: "px-2 py-1 text-dato",
};

export function Button({
  variante = "primario",
  tam = "md",
  className = "",
  children,
  ...props
}: {
  variante?: Variante;
  tam?: Tam;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`${BASE} ${VARIANTE[variante]} ${TAM[tam]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Control segmentado: un grupo de opciones excluyentes donde todas se ven a la
 * vez. Se usa para canal, foco y filtros — casos donde esconder las opciones
 * detrás de un select le cuesta un click al asesor que tiene la llamada abierta.
 */
export function Segmentado<T extends string | null>({
  opciones,
  valor,
  onCambiar,
  tam = "md",
  etiquetaGrupo,
  etiqueta,
}: {
  opciones: { valor: T; etiqueta: ReactNode; title?: string }[];
  valor: T;
  onCambiar: (v: T) => void;
  tam?: Tam;
  /** Nombre accesible del grupo. */
  etiquetaGrupo?: string;
  /** Rótulo visible dentro del control, para grupos que necesitan decir de qué son. */
  etiqueta?: string;
}) {
  return (
    <div
      role="group"
      aria-label={etiquetaGrupo ?? etiqueta}
      className="flex items-center gap-0.5 rounded-md border border-borde bg-superficie p-0.5"
    >
      {etiqueta ? (
        <span className="px-1.5 text-etiqueta font-medium text-tinta-3">
          {etiqueta}
        </span>
      ) : null}
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={String(o.valor)}
            type="button"
            title={o.title}
            aria-pressed={activo}
            onClick={() => onCambiar(o.valor)}
            className={`rounded font-medium select-none outline-none transition-[transform,background-color,color] duration-150 ease-fuerte active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-acento/40 motion-reduce:transition-none motion-reduce:active:scale-100 ${
              tam === "sm" ? "px-2 py-1 text-dato" : "px-2.5 py-1 text-cuerpo"
            } ${
              activo
                ? "bg-acento-suave text-acento"
                : "text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
            }`}
          >
            {o.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
