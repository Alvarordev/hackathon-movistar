-- Trazabilidad de DE DÓNDE sale cada sugerencia.
--
-- En este dataset la contactabilidad no es predecible (AUC 0.500) y la
-- aceptación no varía por canal, así que el canal sugerido NO sale de un
-- modelo: sale de `canal_mas_usado`, la preferencia observada del cliente.
-- Presentarlo como predicción sería vender humo, y el asesor merece saber
-- qué respalda cada cosa que ve en pantalla. Estas columnas hacen esa
-- distinción explícita en el dato mismo, no solo en la documentación.

ALTER TABLE nbo_scores
  ADD COLUMN IF NOT EXISTS canal_origen   TEXT,  -- preferencia_observada | modelo_valor_esperado
  ADD COLUMN IF NOT EXISTS momento_origen TEXT;  -- rechazo_previo_mal_momento | NULL
