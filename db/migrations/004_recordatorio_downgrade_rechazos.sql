-- Contexto que el ranking ignoraba: qué tiene el cliente y qué se le ofreció antes.
--
-- `es_downgrade_datos`: la oferta le da menos GB de los que el cliente
-- realmente consume (con margen). Antes solo se detectaba downgrade de
-- PRECIO en plan_movil, así que un tier de Movistar Total con menos datos
-- que el plan actual podía salir #1 porque "ganaba" en precio.
--
-- `accion` / `fecha_aceptacion_previa`: si el cliente ya ACEPTÓ una oferta MT
-- en el historial pero la contratación nunca se completó (el snapshot sigue
-- con es_movistar_total = false — ver docs/hallazgos_datos.md), la
-- recomendación es la MISMA oferta pero como recordatorio de cierre, no
-- como venta nueva.
--
-- `n_rechazos_previos` / `fecha_ultimo_rechazo`: cuántas veces y cuándo el
-- cliente rechazó ESTA oferta antes. No la excluye del ranking, la penaliza:
-- `valor_esperado_ajustado` es el valor esperado del modelo con ese
-- descuento aplicado, y es lo que ordena la cola.

ALTER TABLE nbo_scores
  ADD COLUMN IF NOT EXISTS accion                  TEXT NOT NULL DEFAULT 'oferta',  -- oferta | recordatorio
  ADD COLUMN IF NOT EXISTS fecha_aceptacion_previa DATE,
  ADD COLUMN IF NOT EXISTS es_downgrade_datos      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS n_rechazos_previos      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_ultimo_rechazo    DATE,
  ADD COLUMN IF NOT EXISTS valor_esperado_ajustado NUMERIC(8,4);

CREATE INDEX IF NOT EXISTS idx_nbo_recordatorio
  ON nbo_scores (cliente_id) WHERE accion = 'recordatorio';
