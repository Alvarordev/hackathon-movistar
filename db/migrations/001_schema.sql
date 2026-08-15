-- Copiloto NBO — esquema.
-- Idempotente a propósito: lo aplica initdb en el primer arranque y también
-- `python -m src.seed` en cada corrida, para que re-sembrar nunca falle.

-- ---------------------------------------------------------------- catálogo
CREATE TABLE IF NOT EXISTS ofertas (
  oferta_id           TEXT PRIMARY KEY,
  nombre_oferta       TEXT NOT NULL,
  tipo_oferta         TEXT NOT NULL,
  segmento_objetivo   TEXT NOT NULL,
  es_movistar_total   BOOLEAN NOT NULL,
  precio_mensual      NUMERIC(10,2) NOT NULL,
  ahorro_pct          INTEGER,          -- ilustrativo, no se usa para el speech
  gb_incluidos        INTEGER,          -- 9999 en el CSV = ilimitado
  gb_ilimitado        BOOLEAN NOT NULL DEFAULT FALSE,
  cluster_hogar       TEXT,
  descripcion_bundle  TEXT,
  descripcion_corta   TEXT
);

-- ---------------------------------------------------------------- clientes
CREATE TABLE IF NOT EXISTS clientes (
  cliente_id              TEXT PRIMARY KEY,
  tipo_cliente            TEXT,          -- NULL legítimo: cliente sin línea móvil
  antiguedad_meses        INTEGER,
  tiene_movil             BOOLEAN,
  tiene_hogar             BOOLEAN,
  oferta_hogar_id         TEXT,
  tiene_internet_hogar    BOOLEAN,       -- != tiene_hogar (solo TV no habilita MT)
  es_movistar_total       BOOLEAN,       -- del CLIENTE, no de la oferta
  elegible_mt             BOOLEAN,
  plan_actual_id          TEXT,
  monto_facturado_prom    NUMERIC(10,2),
  edad_rango              TEXT,
  ubicacion_departamento  TEXT,
  es_usuario_app          BOOLEAN,
  consumo_datos_gb_prom   NUMERIC(12,4),
  consumo_voz_min_prom    NUMERIC(12,4),
  consumo_sms_prom        NUMERIC(12,4),
  uso_app_movistar_prom   NUMERIC(12,4),
  monto_facturado_prom_6m NUMERIC(10,2),
  dias_mora_prom          NUMERIC(10,4),
  meses_moroso            INTEGER,
  n_reclamos              INTEGER,
  n_actividad_canal       INTEGER,
  canal_mas_usado         TEXT           -- NULL si no hubo interacciones
);

-- --------------------------------------------------------------- historial
CREATE TABLE IF NOT EXISTS historial (
  ofrecimiento_id   TEXT PRIMARY KEY,
  cliente_id        TEXT NOT NULL,
  oferta_id         TEXT NOT NULL,
  fecha             DATE NOT NULL,
  canal             TEXT NOT NULL,
  resultado         TEXT NOT NULL,      -- aceptada | rechazada | pendiente
  motivo_rechazo    TEXT,               -- solo si rechazada
  es_rebate         BOOLEAN,
  contactabilidad   TEXT NOT NULL,      -- contactado | no_contactado
  medio_probatorio  TEXT,
  tipo_cliente      TEXT,
  antiguedad_meses  INTEGER,
  elegible_mt       BOOLEAN,
  es_movistar_total BOOLEAN,            -- del cliente al momento del ofrecimiento
  nombre_oferta     TEXT,
  tipo_oferta       TEXT,
  oferta_es_mt      BOOLEAN             -- de la OFERTA presentada
);

CREATE INDEX IF NOT EXISTS idx_historial_cliente ON historial (cliente_id, fecha);
CREATE INDEX IF NOT EXISTS idx_historial_canal   ON historial (canal);
CREATE INDEX IF NOT EXISTS idx_historial_motivo  ON historial (motivo_rechazo);

-- ============================ artefactos del pipeline ====================

-- Features derivadas por cliente. Separadas de `clientes` para que re-correr
-- el pipeline no toque los datos crudos del CSV.
CREATE TABLE IF NOT EXISTS cliente_features (
  cliente_id          TEXT PRIMARY KEY,
  gasto_actual_total  NUMERIC(10,2),
  presion_datos       NUMERIC(10,4),    -- NULL si el plan es ilimitado
  salud_cliente       TEXT,             -- buena | observada | critica
  gap_a_mt            TEXT,             -- ninguno | producto_hogar | internet_hogar
                                        -- | migracion_postpago | no_alcanzable | ya_es_mt
  plan_actual_nombre  TEXT,
  oferta_hogar_nombre TEXT
);

CREATE TABLE IF NOT EXISTS personas (
  cliente_id       TEXT PRIMARY KEY,
  cluster_id       INTEGER NOT NULL,
  persona          TEXT NOT NULL,
  persona_desc     TEXT NOT NULL,
  alerta_retencion BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_alerta    TEXT
);

-- Una fila por (cliente, oferta elegible), ya con el mejor canal elegido.
-- `por_canal` guarda el detalle de los 4 canales para el simulador.
CREATE TABLE IF NOT EXISTS nbo_scores (
  cliente_id        TEXT NOT NULL,
  oferta_id         TEXT NOT NULL,
  rank              INTEGER NOT NULL,
  canal_sugerido    TEXT NOT NULL,
  canal_origen      TEXT,             -- preferencia_observada | modelo_valor_esperado
  momento_sugerido  TEXT,
  momento_origen    TEXT,             -- rechazo_previo_mal_momento | NULL
  prob_contacto     NUMERIC(8,4) NOT NULL,
  prob_aceptacion   NUMERIC(8,4) NOT NULL,
  valor_esperado    NUMERIC(8,4) NOT NULL,
  ahorro_soles      NUMERIC(10,2),
  ahorro_pct_real   NUMERIC(8,4),
  avanza_a_mt       BOOLEAN NOT NULL DEFAULT FALSE,  -- la oferta acerca al cliente a MT
  drivers           JSONB,
  por_canal         JSONB,
  PRIMARY KEY (cliente_id, oferta_id)
);

CREATE INDEX IF NOT EXISTS idx_nbo_cliente_rank ON nbo_scores (cliente_id, rank);

CREATE TABLE IF NOT EXISTS ruta_mt (
  cliente_id               TEXT PRIMARY KEY,
  gap_a_mt                 TEXT NOT NULL,
  descripcion              TEXT,
  oferta_puente_id         TEXT,
  oferta_puente_nombre     TEXT,
  oferta_puente_precio     NUMERIC(10,2),
  prob_puente              NUMERIC(8,4),
  mt_destino_id            TEXT,
  mt_destino_nombre        TEXT,
  mt_destino_precio        NUMERIC(10,2),
  ahorro_soles_proyectado  NUMERIC(10,2)
);

-- KV para los artefactos JSON: rebate_matrix, funnel, metrics.
CREATE TABLE IF NOT EXISTS artefactos (
  nombre      TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  generado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
