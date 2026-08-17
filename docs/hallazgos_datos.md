# Hallazgos del EDA — qué lógica codifica realmente el dataset

Los datos son 100% sintéticos. Las relaciones que aparecen aquí no son verdades
sobre clientes reales: son las reglas que un generador inyectó. El propósito de
este documento no es "descubrir insights", es **recuperar esas reglas** para
modelarlas bien y, sobre todo, para no presentar como predicción algo que en
estos datos es ruido.

Todo lo de abajo es reproducible corriendo el pipeline.

## 1. La única señal fuerte del dataset es Movistar Total

| Universo (solo contactados) | Tasa de aceptación | n |
|---|---|---|
| Oferta **no** MT | **0.341** | 230,411 |
| Oferta **MT** | **0.697** | 24,207 |

Una oferta de Movistar Total convierte **2.04x** mejor que cualquier otra cosa
del portafolio. No hay preferencia entre tiers: Básico 0.696, Plus 0.702,
Max 0.693 — los tres son equivalentes.

Todo lo demás es plano:

| Variable | Rango de la tasa de aceptación (ofertas no-MT) |
|---|---|
| Canal | 0.339 – 0.343 |
| Tipo de oferta | 0.338 – 0.343 |
| Rango de edad | 0.338 – 0.343 |
| Usuario de app | 0.340 – 0.343 |
| Tipo de cliente | 0.337 – 0.341 |
| Mes | 0.371 – 0.377 |

Efectos numéricos débiles pero reales (correlación con la aceptación):
`dias_mora_prom` −0.053, `meses_moroso` −0.049, `antiguedad_meses` +0.041,
`n_reclamos` −0.028. El resto ≈ 0.

**Consecuencia de diseño:** el techo de AUC de este dataset está cerca de 0.57.
Un modelo que reporte 0.85 tiene leakage. Ver sección 5.

**La magnitud también es sintética.** No solo MT es la única señal: su tasa es
irreal. Un cross-sell a clientes existentes convierte 10–30% en la industria, y
una llamada en frío B2B 2–3%; el 0.697 de acá está 2–4x por encima del techo de
lo primero. La comparación justa es contra cross-sell —el cliente ya es de la
casa, la tasa es condicional a haberlo contactado y la oferta le ahorra dinero—
pero el margen sigue siendo enorme. Importa para el pitch: el modelo reporta
69.4% porque el historial mide 69.7%, o sea que está calibrado; el optimismo lo
puso el generador. Sobre datos reales la calibración se reajusta sola. Ver
`contexto_realismo` en `metrics.json` y §5.5 de
[como_funciona.md](como_funciona.md).

## 2. La contactabilidad no es predecible con estos datos

`resultado = 'pendiente'` coincide **exactamente** con
`contactabilidad = 'no_contactado'`: 45,494 = 45,494. Confirma que son dos
lecturas del mismo evento y que tratarlas como rechazo sería un error.

Pero la tasa de contacto es constante en todo:

| Corte | Tasa de contacto |
|---|---|
| Global | 0.8484 |
| Por canal (los 4) | 0.8479 – 0.8494 |
| Por mes (los 6) | 0.8469 – 0.8510 |
| Usuario de app sí / no | 0.848 / 0.849 |
| Canal ofrecido == canal más usado | 0.8487 vs 0.8483 |

El Modelo B alcanza **AUC de test 0.500**. No es un bug del modelo: la variable
no tiene señal. El modelo se mantiene en el pipeline porque es la arquitectura
correcta para datos reales, pero **no se presenta al asesor como recomendador
de canal**. El canal sugerido sale de `canal_mas_usado` —preferencia observada
del cliente— y se etiqueta explícitamente como regla, no como predicción.

Preferimos una regla honesta a un modelo decorativo.

## 3. `es_rebate` es ruido; el motivo de rechazo no predice la recuperación

`es_rebate = True` aparece en 47,572 filas y **todas** son `rechazada`: tasa de
aceptación exactamente 0.0000. Se asigna al azar sobre ~30% de los rechazos, con
distribución de motivo idéntica a la de los rechazos sin rebate (precio 0.347 vs
0.351, etc.).

Por lo tanto, la matriz de rebate **no puede** calcularse como "qué acción con
`es_rebate = True` convirtió mejor": esa cifra es 0 para todas las celdas.

Lo que sí es medible es la **recuperación secuencial**: tras un rechazo, ¿acepta
el cliente el siguiente ofrecimiento?

| Motivo del rechazo | Recuperación en el siguiente ofrecimiento | n |
|---|---|---|
| `precio` | 0.210 | 55,652 |
| `no_confia` | 0.213 | 15,979 |
| `no_necesita` | 0.209 | 31,808 |
| `ya_tiene_similar` | 0.209 | 23,959 |
| `mal_momento` | 0.207 | 23,936 |
| `otro` | 0.215 | 7,870 |

Los seis motivos son estadísticamente indistinguibles: **el motivo no predice
nada**. Pero la *acción* sí:

| Acción tras el rechazo | Recuperación | 
|---|---|
| Siguiente oferta **es MT** | **0.56 – 0.62** |
| Siguiente oferta no es MT | 0.29 |

Y esto vale para los seis motivos por igual. La conclusión empírica es
incómoda pero clara: **en estos datos, la mejor contraoferta para cualquier
motivo de rechazo es pivotar a Movistar Total.**

Por eso la matriz de rebate tiene dos capas separadas y etiquetadas:

- **Capa empírica** — tasas de recuperación por (motivo, acción) con su `n`.
  Celdas con `n < 30` se marcan de confianza baja.
- **Capa de reglas de negocio** — la *naturaleza* de cada motivo, que gobierna
  el **speech**, no la tasa. Un rechazo por `no_confia` no se responde con un
  descuento aunque el número lo permitiera: empeora la objeción. Esta capa es
  criterio de negocio declarado como tal, no un hallazgo de datos.

## 4. `elegible_mt` es el segmento fácil, no el mercado

La columna marca 13,650 clientes (13.7%). Pero la ficha dice que el potencial
es toda la planta, ofreciendo a cada cliente el producto que le falta. Derivando
`gap_a_mt`:

| `gap_a_mt` | Clientes | Qué le falta |
|---|---|---|
| `ninguno` | 13,650 | Nada: ya es elegible (coincide exacto con `elegible_mt`) |
| `producto_hogar` | 32,708 | Un paquete hogar |
| `migracion_postpago` | 13,858 | Migrar de prepago a postpago |
| `internet_hogar` | 2,306 | Tiene TV/fijo, le falta internet |
| `ya_es_mt` | 7,194 | Ya lo tiene |
| `no_alcanzable` | 30,284 | Le falta más de un producto o no tiene línea móvil |

**13,650 → 62,522 clientes alcanzables: 4.6x el mercado** que sugiere la columna
cruda. Esta es la variable que más mueve el caso de negocio.

## 5. `monto_facturado_prom` no es lo que el cliente paga

Comparando el campo contra la suma de precios del catálogo:

| Segmento | n | `monto_facturado_prom` − (precio plan + precio hogar) |
|---|---|---|
| Solo móvil | 54,758 | 0.00 |
| Móvil + hogar | 38,048 | **−109.15** |
| Ya es MT | 7,194 | +0.34 |

`monto_facturado_prom` refleja **solo el plan móvil**. Para un cliente
convergente, lo que realmente paga son ~S/109 más. Un asesor que mira la
facturación en pantalla **subestima el ahorro de MT por ese margen**.

Por eso `gasto_actual_total = precio(plan_actual) + precio(oferta_hogar)` no es
cosmética: es el número con el que se arma el speech. Para clientes que ya son
MT, `plan_actual_id` es el propio tier MT y sumar el hogar duplicaría el cargo.

## 6. Otras trampas confirmadas en los datos

- `tiene_hogar` (45,242) ≠ `tiene_internet_hogar` (40,786). Los 4,456 de
  diferencia tienen TV o fijo sin internet: **no son elegibles a MT**.
- `tipo_cliente` nulo en 6,734 filas = clientes sin línea móvil. Nulo legítimo.
- `gb_incluidos = 9999` (OF004, OF022) significa ilimitado. Como número crudo
  distorsiona cualquier ratio; se convierte a nulo con un flag aparte.
- `es_movistar_total` (del cliente) ≠ `oferta_es_mt` (de la oferta presentada).
- **El snapshot del cliente no es el resultado de aplicar el historial.** De los
  9,639 clientes que aceptaron una oferta de Movistar Total en el historial,
  **los 9,639** siguen con `es_movistar_total = false` en la tabla de clientes;
  y los 7,194 marcados como MT no aceptaron ninguna. Son dos tiradas
  independientes del generador, no un estado y su evolución.

  Consecuencia práctica: no se puede reconstruir el estado del cliente en cada
  ofrecimiento pasado a partir del snapshot. Por eso el entrenamiento usa los
  atributos *point-in-time* que el propio historial copia
  (`tipo_cliente`, `antiguedad_meses`, `elegible_mt`, `es_movistar_total`) en
  lugar de los del snapshot, que respecto del evento son del futuro.
- El historial tiene **6 fechas distintas en total**: el día 10 de cada mes
  (49,763–50,366 ofrecimientos cada una). No existe resolución intra-mes, así
  que `dia_semana` es colineal con `mes` y se excluyó de las features. Y como
  además la tasa de contacto es plana entre meses, **no hay ningún "mejor
  momento" derivable de los datos**. El campo `momento_sugerido` va nulo salvo
  cuando hay una señal real: un rechazo previo por `mal_momento`, donde sí se
  reporta la mediana observada de días hasta el siguiente ofrecimiento.

## 7. Qué significa esto para las métricas del modelo

Con una sola regla real en los datos, el techo es bajo. Se reporta comparando
tres niveles, para que el número sea interpretable:

| Nivel | AUC de test (aceptación) |
|---|---|
| Tasa base constante | 0.500 |
| Regla de una variable: "¿la oferta es MT?" | 0.5635 |
| **Modelo A completo (41 features)** | **0.5890** |

El modelo aporta +0.0255 sobre la regla de una sola variable; ese margen es todo
lo que contienen las otras 40 features, y es consistente con los efectos débiles
de mora y antigüedad de la sección 1.

El gap train/test es 0.019 (0.6078 vs 0.5890) tras regularizar. Con los defaults
de LightGBM era 0.16 (0.7426 vs 0.5818): el modelo memorizaba al cliente, porque
cada cliente aparece ~3.2 veces en el historial. Como al asesor le mostramos la
probabilidad en pantalla, una probabilidad mal calibrada es peor que no mostrar
ninguna. Brier de test: 0.2230.
