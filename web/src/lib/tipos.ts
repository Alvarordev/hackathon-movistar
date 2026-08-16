/**
 * Tipos del contrato de datos (docs/contrato_datos.md).
 *
 * Se declaran a mano y no se generan: el contrato es la fuente de verdad y
 * escribirlo explícitamente obliga a que cualquier cambio de API pase por acá.
 */

export type Canal = "Tienda" | "Call In" | "Call Out" | "Digital";
export const CANALES: Canal[] = ["Tienda", "Call In", "Call Out", "Digital"];

export type Motivo =
  | "precio"
  | "ya_tiene_similar"
  | "no_necesita"
  | "no_confia"
  | "mal_momento"
  | "otro";

export type GapMt =
  | "ninguno"
  | "producto_hogar"
  | "internet_hogar"
  | "migracion_postpago"
  | "no_alcanzable"
  | "ya_es_mt";

export interface Persona {
  cluster_id: number;
  nombre: string;
  descripcion: string;
}

export interface Cliente {
  cliente_id: string;
  tipo_cliente: "prepago" | "postpago" | null;
  antiguedad_meses: number;
  tiene_movil: boolean;
  tiene_hogar: boolean;
  tiene_internet_hogar: boolean;
  es_movistar_total: boolean;
  elegible_mt: boolean;
  plan_actual_id: string | null;
  plan_actual_nombre: string | null;
  oferta_hogar_id: string | null;
  oferta_hogar_nombre: string | null;
  monto_facturado_prom: number;
  monto_facturado_prom_6m: number;
  gasto_actual_total: number;
  edad_rango: string;
  departamento: string;
  es_usuario_app: boolean;
  consumo_datos_gb_prom: number;
  consumo_voz_min_prom: number;
  consumo_sms_prom: number;
  uso_app_movistar_prom: number;
  canal_mas_usado: Canal | null;
  n_actividad_canal: number;
  dias_mora_prom: number;
  meses_moroso: number;
  n_reclamos: number;
  gap_a_mt: GapMt;
  presion_datos: number | null;
  salud_cliente: "buena" | "observada" | "critica";
  persona: Persona | null;
  alerta_retencion: boolean;
  motivo_alerta: string | null;
}

export interface Driver {
  feature: string;
  valor: number | string | boolean;
  contribucion: number;
  /** Signo de la contribución del modelo: separa argumentos de objeciones. */
  a_favor?: boolean;
  texto: string;
}

export interface ProbaCanal {
  canal: Canal;
  prob_contacto: number;
  prob_aceptacion: number;
  valor_esperado: number;
}

export interface Recomendacion {
  rank: number;
  oferta_id: string;
  nombre_oferta: string;
  tipo_oferta: string;
  descripcion_corta: string | null;
  precio_mensual: number;
  es_movistar_total: boolean;
  gb_incluidos: number | null;
  gb_ilimitado: boolean;
  canal_sugerido: Canal;
  canal_origen: string | null;
  momento_sugerido: string | null;
  momento_origen: string | null;
  prob_contacto: number;
  prob_aceptacion: number;
  valor_esperado: number;
  ahorro_soles: number | null;
  ahorro_pct_real: number | null;
  avanza_a_mt: boolean;
  drivers: Driver[];
  por_canal: ProbaCanal[];
}

export interface RutaMt {
  gap: GapMt;
  descripcion: string;
  oferta_puente_id: string;
  oferta_puente_nombre: string;
  oferta_puente_precio: number;
  prob_puente: number;
  mt_destino_id: string;
  mt_destino_nombre: string;
  mt_destino_precio: number;
  ahorro_soles_proyectado: number;
}

export interface Nbo {
  cliente_id: string;
  abstenerse: boolean;
  motivo_abstencion: string | null;
  generado_en: string;
  recomendaciones: Recomendacion[];
  ruta_mt: RutaMt | null;
}

export interface EventoJourney {
  ofrecimiento_id: string;
  fecha: string;
  oferta_id: string;
  nombre_oferta: string;
  tipo_oferta: string;
  oferta_es_mt: boolean;
  canal: Canal;
  contactabilidad: "contactado" | "no_contactado";
  resultado: "aceptada" | "rechazada" | "pendiente";
  motivo_rechazo: Motivo | null;
  es_rebate: boolean;
  medio_probatorio: string | null;
}

export interface Journey {
  cliente_id: string;
  resumen: {
    n_ofrecimientos: number;
    n_aceptados: number;
    n_rechazados: number;
    n_no_contactado: number;
    veces_ofrecido_mt: number;
    nunca_ofrecido_mt: boolean;
    motivo_rechazo_dominante: Motivo | null;
  };
  eventos: EventoJourney[];
  fricciones: Array<Record<string, unknown>>;
}

export interface AccionRebate {
  accion: string;
  descripcion: string;
  tasa_conversion: number;
  n: number;
  confianza: "alta" | "baja";
  dias_mediana_hasta_siguiente: number | null;
  coherente_con_naturaleza: boolean;
  razon_descarte?: string;
}

export interface Rebate {
  motivo: Motivo;
  naturaleza: string;
  explicacion_naturaleza: string;
  tasa_base: number;
  n_total: number;
  acciones: AccionRebate[];
  acciones_descartadas: AccionRebate[];
  nota_metodologica?: string;
}

export interface ClientePrioridad {
  cliente_id: string;
  oferta_id: string;
  nombre_oferta: string;
  es_movistar_total: boolean;
  avanza_a_mt: boolean;
  rank: number;
  valor_esperado: number;
  prob_aceptacion: number;
  ahorro_soles: number | null;
  canal_sugerido: Canal;
  gap_a_mt: GapMt | null;
  persona: string | null;
  tiene_ruta_mt: boolean;
  ahorro_soles_proyectado: number | null;
  nunca_ofrecido_mt: boolean;
}

export interface Prioridades {
  foco: "mt" | "todos";
  canal: Canal | null;
  solo_nunca_ofertados: boolean;
  /** Clientes en la cola con estos filtros. `n` es solo los de esta página. */
  total: number;
  limit: number;
  offset: number;
  n: number;
  clientes: ClientePrioridad[];
}

export interface FiltrosSegmento {
  edad_rango?: string;
  departamento?: string;
  tipo_cliente?: "postpago" | "prepago";
  cluster_id?: number;
  gap_a_mt?: GapMt;
  salud_cliente?: "buena" | "observada" | "critica";
  canal_mas_usado?: Canal;
  elegible_mt?: boolean;
  es_movistar_total?: boolean;
  es_usuario_app?: boolean;
}

/** Devuelto cuando ningún cliente cumple los filtros: sin bloques que promediar. */
export interface SegmentoVacio {
  filtros_aplicados: FiltrosSegmento;
  n_clientes: 0;
  pct_de_la_base: number;
  confianza: "baja";
  nota: string;
}

export interface AnalisisSegmento {
  filtros_aplicados: FiltrosSegmento;
  n_clientes: number;
  pct_de_la_base: number;
  confianza: "alta" | "baja";
  perfil: {
    antiguedad_meses_prom: number;
    gasto_actual_total_prom: number;
    consumo_datos_gb_prom: number;
    dias_mora_prom: number;
    n_postpago: number;
    n_prepago: number;
    n_sin_movil: number;
    n_usuarios_app: number;
    pct_usuarios_app: number;
  };
  movistar_total: {
    n_elegibles: number;
    pct_elegibles: number;
    n_ya_mt: number;
    pct_ya_mt: number;
    n_elegibles_nunca_ofertados: number;
    desglose_gap: Array<{ gap: GapMt; n: number; pct: number }>;
  };
  salud: {
    n_buena: number;
    n_observada: number;
    n_critica: number;
    n_abstencion: number;
    pct_abstencion: number;
  };
  personas: Array<{
    cluster_id: number;
    persona: string;
    n: number;
    pct: number;
  }>;
  /** Proyección del modelo: qué recomendaría hoy, no lo que ya pasó. */
  oportunidad: Array<{
    oferta_id: string;
    nombre_oferta: string;
    es_movistar_total: boolean;
    n_clientes: number;
    pct: number;
    valor_esperado_prom: number;
    ahorro_soles_prom: number | null;
  }>;
  /** Medida sobre el historial real. Tasa null = nunca se le ofreció nada. */
  conversion_historica: {
    n_ofrecimientos: number;
    n_aceptadas: number;
    tasa: number | null;
    n_ofrecimientos_mt: number;
    n_aceptadas_mt: number;
    tasa_mt: number | null;
  };
  nota_metodologica: string;
}

export interface EtapaFunnel {
  etapa: string;
  n: number;
  pct_del_anterior: number | null;
}

export interface Funnel {
  canal: Canal | null;
  etapas: EtapaFunnel[];
  medios_probatorios: Record<string, number>;
  rechazos_por_motivo: Record<string, number>;
  mt: {
    ofrecimientos_mt: number;
    aceptados_mt: number;
    pct_ofrecimientos_con_mt: number;
    pct_venta_con_mt: number;
  };
  por_canal?: Funnel[];
}

export interface Metrics {
  generado_en: string;
  modelo_aceptacion: {
    auc_test: number;
    auc_train: number;
    auc_baseline_solo_mt: number | null;
    aporte_sobre_baseline: number | null;
    brier_test: number;
    n_train: number;
    n_valid: number;
    n_test: number;
    tasa_base_train: number;
    lift_decil_superior: number;
    lift_por_decil: number[];
    n_arboles: number;
    n_features: number;
    split: Record<string, string>;
  };
  modelo_contactabilidad: {
    auc_test: number;
    predecible: boolean;
    nota: string;
  };
  importancia_aceptacion: Array<{ feature: string; gain: number }>;
  cobertura_perdida_mt: {
    clientes_elegibles: number;
    nunca_ofertados_mt: number;
    pct: number;
  };
  participacion_mt: {
    definicion: string;
    venta_hogar_actual_pct: number;
    meta_hogar_pct: number;
    venta_movil_actual_pct: number;
    meta_movil_pct: number;
  };
  proyeccion_modelo: {
    metodo: string;
    ventas_esperadas_total: number;
    ventas_esperadas_mt: number;
    proyectada_hogar_pct: number;
    proyectada_movil_pct: number;
  };
  mercado_ampliado_mt: {
    ya_elegibles: number;
    a_un_producto: number;
    total_alcanzable: number;
    multiplicador_vs_columna_cruda: number;
    desglose_gap: Record<string, number>;
  };
  abstenciones: { clientes_con_alerta: number; pct: number; criterio: string };
  segmentacion: {
    k: number;
    clusters: Array<{ cluster_id: number; nombre: string; descripcion: string; n: number }>;
  };
}

export interface ErrorApi {
  error: string;
  detalle: string;
}
