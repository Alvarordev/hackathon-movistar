/**
 * Cliente de la API propia.
 *
 * Las páginas son Server Components y llaman a estas funciones en el servidor,
 * así que la base es interna (localhost dentro del contenedor). Los pocos
 * componentes cliente que refetchean —el simulador de canal— pasan por rutas
 * relativas del navegador.
 */
import type {
  Cliente,
  Funnel,
  Journey,
  Metrics,
  Nbo,
  Prioridades,
  Rebate,
} from "./tipos";

const BASE_SERVIDOR = process.env.API_BASE ?? "http://127.0.0.1:3000/api";

export class ApiError extends Error {
  constructor(
    readonly codigo: string,
    readonly detalle: string,
    readonly status: number,
  ) {
    super(`${codigo}: ${detalle}`);
  }
}

async function pedir<T>(ruta: string): Promise<T> {
  const res = await fetch(`${BASE_SERVIDOR}${ruta}`, { cache: "no-store" });
  if (!res.ok) {
    const cuerpo = await res.json().catch(() => null);
    throw new ApiError(
      cuerpo?.error ?? "error_interno",
      cuerpo?.detalle ?? res.statusText,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

/** Devuelve null si el recurso no existe, en vez de lanzar. */
async function pedirOpcional<T>(ruta: string): Promise<T | null> {
  try {
    return await pedir<T>(ruta);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

function qs(params: Record<string, string | number | boolean | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  cliente: (id: string) => pedirOpcional<Cliente>(`/clientes/${id}`),

  nbo: (id: string, opts: { canal?: string; limit?: number } = {}) =>
    pedirOpcional<Nbo>(`/clientes/${id}/nbo${qs(opts)}`),

  journey: (id: string) => pedirOpcional<Journey>(`/clientes/${id}/journey`),

  prioridades: (
    opts: {
      foco?: string;
      canal?: string;
      solo_nunca_ofertados?: boolean;
      limit?: number;
    } = {},
  ) => pedir<Prioridades>(`/prioridades${qs(opts)}`),

  rebate: (motivo: string) => pedir<Rebate>(`/rebate${qs({ motivo })}`),

  funnel: (canal?: string) => pedir<Funnel>(`/funnel${qs({ canal })}`),

  metrics: () => pedir<Metrics>("/metrics"),
};

// ------------------------------------------------------------ formateo

/** Soles con dos decimales. Siempre con el prefijo, nunca un número pelado:
 *  el asesor lee esto en voz alta. */
export function soles(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `S/ ${Math.abs(v).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pct(v: number | null | undefined, decimales = 0): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(decimales)}%`;
}

export function numero(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("es-PE");
}

export function fecha(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const ETIQUETA_GAP: Record<string, string> = {
  ninguno: "Elegible a MT",
  producto_hogar: "Le falta hogar",
  internet_hogar: "Le falta internet",
  migracion_postpago: "Le falta postpago",
  no_alcanzable: "Fuera de ruta MT",
  ya_es_mt: "Ya tiene MT",
};

export function etiquetaGap(gap: string | null | undefined): string {
  if (!gap) return "—";
  return ETIQUETA_GAP[gap] ?? gap;
}

const ETIQUETA_MOTIVO: Record<string, string> = {
  precio: "Está caro",
  ya_tiene_similar: "Ya tiene algo similar",
  no_necesita: "No lo necesita",
  no_confia: "No confía",
  mal_momento: "Mal momento",
  otro: "Otro motivo",
};

export function etiquetaMotivo(m: string): string {
  return ETIQUETA_MOTIVO[m] ?? m;
}

/** De dónde sale una sugerencia, en lenguaje de asesor. La distinción entre
 *  modelo y regla es un compromiso del proyecto: se muestra, no se esconde. */
const ETIQUETA_ORIGEN: Record<string, string> = {
  preferencia_observada: "canal que más usa el cliente",
  modelo_valor_esperado: "estimado por el modelo",
  forzado_por_asesor: "seleccionado por ti",
  rechazo_previo_mal_momento: "por un rechazo previo por mal momento",
};

export function etiquetaOrigen(origen: string | null | undefined): string | null {
  if (!origen) return null;
  return ETIQUETA_ORIGEN[origen] ?? origen;
}
