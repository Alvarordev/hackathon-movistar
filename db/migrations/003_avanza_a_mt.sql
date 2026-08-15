-- Política de blindaje en el ranking.
--
-- El modelo no distingue entre ofertas no-MT (los empates de valor esperado a
-- 4 decimales son la norma, no la excepción). Dentro de un empate técnico,
-- QUÉ oferta queda #1 es una decisión de política, no de modelo — y la
-- política del desafío es blindar la planta con Movistar Total.
--
-- `avanza_a_mt` marca si la oferta acerca al cliente a MT: es una oferta MT,
-- o es el producto puente que cierra su gap (internet hogar para gaps de
-- hogar, plan móvil postpago para prepago con internet).

ALTER TABLE nbo_scores
  ADD COLUMN IF NOT EXISTS avanza_a_mt BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_nbo_avanza
  ON nbo_scores (avanza_a_mt, valor_esperado DESC) WHERE rank = 1;
