# Cómo funciona el Copiloto NBO

Este documento explica el proyecto a nivel técnico, conceptual y de diseño: qué construimos, por qué lo construimos así, qué decisiones tomamos y por qué, y qué aprendimos de los datos que cambió el diseño sobre la marcha. No es un resumen — es la explicación completa, pensada para que alguien que no escribió el código pueda entender el sistema de punta a punta.

Documentos relacionados, más específicos:
- [contrato_datos.md](contrato_datos.md) — el contrato exacto de cada endpoint de la API.
- [hallazgos_datos.md](hallazgos_datos.md) — el EDA completo con cifras.
- `pipeline/artifacts/model_card.md` — generado por el pipeline, métricas de los modelos.
- [../README.md](../README.md) — cómo levantar y desplegar el proyecto.

---

## 1. El problema y el encargo

Este proyecto responde al **Desafío 02 — Personalización comercial inteligente** del hackatón *AI Telecom Challenge 2026*, organizado por Movistar y la Universidad de Lima. La ficha del desafío pide una solución de IA que recomiende, de manera inteligente y personalizada, la mejor oferta comercial para cada cliente — un motor de **Next Best Offer (NBO)** — con **Movistar Total (MT)** como caso de uso prioritario para blindar la planta de clientes contra la fuga (churn).

El motor tiene que responder cinco preguntas por cada cliente:

1. ¿Cuál es el **cliente potencial**?
2. ¿Por qué **canal** es más propenso a comprar?
3. ¿Cuál es el **momento** idóneo?
4. ¿Cuál es el **mensaje / oferta** idónea según su necesidad?
5. ¿Cuál es la **probabilidad de aceptación**, el **motivo de rechazo** probable y su solución (rebate)?

Y además debe dar **seguimiento E2E** (end-to-end) del ofrecimiento hasta el resultado de venta — trazabilidad completa, no solo la recomendación puntual.

La ficha es explícita sobre qué se evalúa: *"El desafío no consiste únicamente en lograr el algoritmo con el mayor accuracy en el dataset, sino en demostrar cómo ese algoritmo resuelve el problema planteado"*. Y valora especialmente *"la creación de variables ingeniosas combinando datos"* y *"la simplicidad para traducir los resultados técnicos a una interfaz limpia, intuitiva y fácil de usar para un asesor bajo presión de tiempo"*.

Esa última frase es la que más pesó en el diseño: **el usuario final no es el jurado ni un data scientist, es un asesor comercial con un cliente esperando en la línea.**

---

## 2. Qué construimos: el Copiloto NBO

No construimos un chatbot para el cliente final, ni un dashboard analítico para gerencia. Construimos una **herramienta interna de asesor**, pensada para simular lo que sería un módulo dentro de las plataformas que Movistar ya usa (DITO para venta, Visor para postventa). El asesor la usa *mientras* atiende — en Tienda, Call In, Call Out o Digital — no antes ni después.

Esa decisión de producto viene de leer la ficha con cuidado: dice que el flujo de ofrecimiento "varía por canal" y que se necesita algo que el asesor consulte en el momento, no un reporte que alguien lee al final del día. Por eso la interfaz entera está diseñada bajo una restricción dura: **durante la atención al cliente, el asesor no navega**. Todo lo que necesita está en una sola pantalla.

El sistema tiene tres piezas que trabajan juntas:

1. **Un motor de recomendación** (modelos supervisados + reglas de negocio) que decide qué ofrecer, a quién, por qué canal, y con qué probabilidad de éxito.
2. **Un copiloto conversacional** (LLM con tool calling) que traduce las decisiones del motor a lenguaje natural — argumentos, speeches, respuestas a objeciones.
3. **Una interfaz de asesor** que junta ambas cosas en tres pantallas: una cola de trabajo, un cockpit de atención, y un panel de supervisión.

---

## 3. El principio arquitectónico central

Todo el diseño del sistema —desde el pipeline de datos hasta el último componente de la UI— se sostiene sobre una sola frase:

> **El modelo decide y es auditable. El LLM explica, argumenta y conversa.**

Esto no es una preferencia estética, es una restricción dura con una regla operativa: **el LLM no puede pronunciar ninguna cifra — probabilidad, precio, ahorro, tasa de conversión — que no venga de un resultado de tool.** Si no tiene el dato, lo dice explícitamente en vez de inventarlo.

### Por qué esta restricción y no otra

Se podría haber diseñado el sistema al revés: darle al LLM acceso a los datos crudos del cliente y dejar que él mismo razone qué ofrecer, estime una probabilidad y arme el argumento, todo en una sola pasada. Es más simple de construir. Se descartó por tres razones, en orden de importancia:

**Primera, es un argumento de negocio, no solo técnico.** En telecomunicaciones — un sector regulado, donde cada ofrecimiento queda registrado con un medio probatorio (grabación de llamada, log de chat, registro de plataforma) — ningún sistema puede permitirse que un modelo de lenguaje "improvise" una cifra frente a un cliente. Si un LLM dice "80% de probabilidad de que acepte" y ese número salió de su intuición estadística sobre el lenguaje y no de un modelo entrenado sobre datos reales de conversión, la empresa no tiene cómo defender esa cifra si el cliente reclama, o si un regulador audita el proceso comercial.

**Segunda, es una cuestión de calibración.** Los modelos de lenguaje son excelentes generando texto plausible, pero no están calibrados para producir probabilidades numéricas correctas — no hay garantía de que "70%" dicho por un LLM corresponda a una tasa de éxito real del 70% en casos similares. Un modelo de clasificación binaria entrenado y evaluado sobre datos históricos, en cambio, sí puede calibrarse y auditarse (ver la sección de Brier score más abajo).

**Tercera, es una cuestión de trazabilidad para el propio proyecto.** Si el LLM decidiera qué ofrecer, cambiar de proveedor de IA (de Gemini a Claude, por ejemplo) podría cambiar silenciosamente las recomendaciones de negocio. Con la arquitectura elegida, cambiar de proveedor solo cambia *cómo se explica* la recomendación, nunca *cuál es* la recomendación.

### Cómo se aplica en la práctica

- El **modelo de aceptación** (LightGBM) calcula la probabilidad de que un cliente acepte una oferta específica. Esa cifra sale de un pipeline auditable, con split temporal y verificación explícita de que no hay fuga de datos.
- El **modelo de contactabilidad** calcula la probabilidad de que el cliente conteste.
- El **ranking de ofertas** (`valor_esperado = P(contacto) × P(aceptación)`) es una decisión determinística, no del LLM.
- La **matriz de rebate** (qué responder ante una objeción) es una tabla de tasas medidas empíricamente sobre el historial, no una sugerencia del LLM.
- El **LLM (el copiloto)** solo entra al final: llama a "tools" que consultan estos resultados ya calculados, y traduce el JSON que reciben a una frase que un asesor pueda decir en voz alta. El copiloto tiene diez tools disponibles (`get_cliente`, `get_nbo`, `get_journey`, `sugerir_rebate`, `calcular_ahorro`, `get_ruta_mt`, `evaluar_oferta`, `proximos_clientes`, `analizar_segmento`, `listar_ofertas`) y un system prompt que le prohíbe explícitamente inventar cifras.

Esta arquitectura tiene una ventaja adicional no evidente al principio: hace que la UI y el copiloto **nunca puedan contradecirse**. Como ambos leen exactamente las mismas funciones de acceso a datos (`web/src/lib/queries.ts`), si la pantalla dice que la oferta cuesta S/149.90, el copiloto jamás podría decir S/160 — leen la misma fuente.

---

## 4. Los datos: qué hay y qué trampas tiene

El desafío entrega tres CSV, 100% sintéticos (generados artificialmente, no son datos reales de clientes), que cubren seis meses (enero–junio de 2026):

- **`dataset_clientes.csv`** — 100,000 clientes, con su perfil, consumo, facturación y comportamiento de canal.
- **`catalogo_ofertas_entrega.csv`** — 22 ofertas del portafolio (planes móviles, planes hogar, upgrades, equipos, paquetes adicionales, y las 3 variantes de Movistar Total).
- **`historial_campanias.csv`** — 300,112 eventos de ofrecimiento: qué oferta se le presentó a qué cliente, por qué canal, con qué resultado.

### Por qué el EDA (análisis exploratorio) fue la parte más importante del proyecto

Como los datos son sintéticos, un generador de software los produjo siguiendo ciertas reglas internas. Esto cambia el propósito del análisis exploratorio: no se trata de "descubrir insights de negocio" (no hay negocio real detrás), sino de **recuperar la lógica que el generador inyectó**, para modelarla honestamente en vez de perseguir un número de accuracy que no significaría nada.

Este paso reveló cinco hallazgos que cambiaron decisiones de diseño de fondo. Están documentados con el detalle estadístico completo en [hallazgos_datos.md](hallazgos_datos.md); aquí se resume el *por qué importan*.

#### Hallazgo 1 — Solo hay una señal fuerte de verdad: Movistar Total

Se midió la tasa de aceptación de ofertas por cada variable disponible. El resultado es contundente: una oferta de Movistar Total convierte al **69.7%**, contra **34.1%** de cualquier otra oferta del portafolio — más del doble. Todas las demás variables (canal, mes, edad, uso de la app, tipo de cliente) producen diferencias de menos de un punto porcentual.

Esto significa que el **techo de predictibilidad** de estos datos es bajo: un modelo que solo sepa "¿es MT o no?" ya captura casi toda la señal disponible. Por eso el proyecto reporta el AUC del modelo (0.587) **comparado contra ese baseline de una sola variable (0.564)**, en vez de reportarlo solo — un AUC de 0.85 en este dataset sería sospechoso de fuga de datos, no un logro.

#### Hallazgo 2 — La contactabilidad no se puede predecir

Se probó si el canal, el mes, o el perfil del cliente influyen en si se logra contactarlo. La tasa de contacto es **constante en 84.8%** sin importar el canal, el mes o casi cualquier variable de perfil. El modelo de contactabilidad entrenado sobre estos datos da un AUC de 0.4998 — literalmente equivalente a adivinar al azar.

Esto obligó a una decisión honesta: **el canal sugerido en la UI no se presenta como una predicción del modelo**, porque no hay ninguna. Se muestra como lo que realmente es — el canal que el cliente más usa históricamente (`canal_mas_usado`) — y se etiqueta explícitamente en la interfaz con el origen ("preferencia observada" vs. "estimado por el modelo"), para que nadie confunda una regla simple con una predicción sofisticada. El modelo de contactabilidad se entrena y se deja en el pipeline (porque sería la arquitectura correcta si los datos tuvieran señal real), pero su output no alimenta directamente el canal sugerido.

#### Hallazgo 3 — La columna `es_rebate` es ruido puro

El plan original era calcular la matriz de rebate (qué responder ante cada objeción) usando la columna `es_rebate` del historial: filas marcadas como "esto fue una contraoferta tras un rechazo". Al revisar los datos, se encontró que esa columna marca 47,572 filas — y **el 100% de ellas tiene resultado "rechazada"**, con tasa de aceptación exactamente 0.0000%. La bandera se reparte al azar sobre aproximadamente el 30% de los rechazos, sin relación real con si la oferta se aceptó después.

En vez de forzar el análisis original y obtener una matriz vacía (0% en las 36 celdas), se rediseñó el cálculo: se mide la **recuperación secuencial** — de cada cliente que rechazó una oferta, ¿aceptó la *siguiente* que se le ofreció, y qué acción se tomó entre una y otra (bajar el precio, pivotar a MT, cambiar de canal)? Esto sí tiene señal real y es la base de la matriz de rebate que usa el copiloto hoy.

#### Hallazgo 4 — `elegible_mt` es el segmento fácil, no el mercado real

La columna `elegible_mt` del dataset marca 13,650 clientes como "cumple los requisitos para Movistar Total". Pero la ficha del desafío pide explícitamente identificar "el producto que le falta a cada cliente para convertirse en MT" — es decir, mirar más allá de quién ya califica.

Se derivó una nueva variable, `gap_a_mt`, que clasifica a cada cliente según qué le falta exactamente:

| Situación del cliente | Categoría `gap_a_mt` | Cuántos clientes |
|---|---|---|
| Ya cumple los requisitos | `ninguno` | 13,650 |
| Tiene móvil postpago, no tiene ningún servicio hogar | `producto_hogar` | 32,708 |
| Tiene móvil postpago y hogar, pero solo TV o fijo (sin internet) | `internet_hogar` | 2,306 |
| Tiene internet hogar, pero su línea móvil es prepago | `migracion_postpago` | 13,858 |
| Ya tiene Movistar Total | `ya_es_mt` | 7,194 |
| Le falta más de un producto, o no tiene línea móvil | `no_alcanzable` | 30,284 |

Esto amplía el **mercado alcanzable** de 13,650 a **62,522 clientes — 4.6 veces más** que lo que sugiere la columna cruda. Es la variable que más mueve el argumento de negocio del proyecto, y responde directamente a lo que la ficha pide como "variable ingeniosa combinando datos".

#### Hallazgo 5 — Lo que factura el cliente no es lo que realmente paga

Se comparó `monto_facturado_prom` (el campo de facturación del dataset) contra la suma de precios del catálogo para cada cliente. El resultado: ese campo **solo refleja el plan móvil**. Para un cliente con servicios de hogar además del móvil, lo que realmente paga cada mes es en promedio **S/109 más** de lo que ese campo muestra.

Esto llevó a construir `gasto_actual_total = precio(plan_actual) + precio(oferta_hogar)`, la cifra que realmente importa para calcular el ahorro de Movistar Total. Sin esta corrección, un asesor mirando la pantalla estaría subestimando el ahorro real de MT por ese margen — y el mensaje de venta sería menos convincente de lo que debería.

### Trampas adicionales del dataset (documentadas y manejadas)

- `es_movistar_total` (del **cliente**: ¿ya lo tiene?) es distinto de `oferta_es_mt` (de la **oferta ofrecida** en ese evento del historial). El diccionario de datos lo marca como el error más fácil de cometer, y efectivamente se verificó: de 9,639 clientes que aceptaron una oferta MT en el historial, ninguno tiene `es_movistar_total = true` en el snapshot actual — son dos "tiradas" independientes del generador de datos sintéticos, no un estado y su evolución. Por eso el modelo usa los atributos "point-in-time" que el propio historial copia (estado del cliente al momento del ofrecimiento), en vez del snapshot actual, que temporalmente es "del futuro" respecto al evento.
- `tiene_hogar` no es lo mismo que `tiene_internet_hogar` — un cliente puede tener solo TV o solo línea fija, sin internet, y eso no lo habilita para MT.
- `tipo_cliente` nulo significa "no tiene línea móvil", es un nulo legítimo, no un dato faltante.
- `gb_incluidos = 9999` en el catálogo significa "ilimitado", no literalmente 9999 gigabytes — tratarlo como número crudo distorsionaría cualquier cálculo de ratio de consumo.
- El historial solo tiene **6 fechas distintas en total** (el día 10 de cada mes). No hay ninguna resolución horaria o de día de semana, así que el sistema **no inventa** un "mejor momento del día" — el campo `momento_sugerido` queda vacío salvo cuando hay una señal real y verificable (un rechazo previo por "mal momento").

---

## 5. El pipeline de datos y modelado

El pipeline vive en `pipeline/`, escrito en Python (pandas, LightGBM, scikit-learn) y corre en 8 pasos secuenciales (`pipeline/src/run_all.py`), cada uno con su propio módulo:

```
1. seed              → carga los 3 CSV crudos a Postgres
2. features           → construye las variables derivadas por cliente
3. modelos             → entrena Modelo A (aceptación) y Modelo B (contactabilidad)
4. segmentacion         → clustering K-means + capa de reglas interpretable
5. rebate                → matriz de rebate empírica
6. scoring                → scoring masivo cliente × oferta × canal
7. agregados                → funnel E2E, métricas de impacto, model card
8. seed_artefactos            → carga todos los resultados a Postgres
```

Corre completo con un solo comando (`python -m src.run_all`) y tarda menos de 5 minutos en una máquina normal — clave para una demo de 15 horas donde no se puede perder tiempo entrenando.

### 5.1 — Feature engineering

Además de las columnas crudas del dataset, el pipeline construye (en `pipeline/src/features.py` y `pipeline/src/dataset.py`) un conjunto de variables derivadas que capturan la lógica de negocio que el generador de datos codificó:

- **`gasto_actual_total`** — lo que el cliente realmente paga (ver Hallazgo 5).
- **`gap_a_mt`** — la ruta de conversión a MT en un solo paso (ver Hallazgo 4).
- **`ahorro_soles`** — la diferencia en soles entre lo que paga hoy y lo que pagaría con una oferta específica, calculada solo cuando tiene sentido comercial (una oferta *reemplaza* algo que el cliente ya paga; un paquete adicional o un equipo se *suman* a la factura y ahí no hay "ahorro" que declarar).
- **`presion_datos`** — cuánto se le queda corto el plan actual (`consumo_datos_gb_prom / gb_incluidos`), detectando a quién le urge un upgrade.
- **`salud_cliente`** — un compuesto de meses en mora, días de mora promedio y número de reclamos, clasificado en "buena", "observada" o "crítica".
- **`ratio_precio_oferta_facturacion`**, **`es_upgrade`**, **`delta_gb`**, **`cubre_presion_datos`** — variables de interacción cliente-oferta.

### 5.2 — Los dos modelos: por qué se separan en dos

La ficha pide identificar "canal", "momento" y "probabilidad de aceptación" como preguntas distintas. Eso llevó a descomponer el problema en dos modelos independientes, en vez de uno solo:

```
Valor esperado = P(contactar | canal, cliente) × P(aceptar | contactado, oferta, canal)
```

**Modelo A — Aceptación.** Responde "si logramos contactar al cliente y le presentamos esta oferta, ¿la acepta?". Solo se entrena con eventos donde `contactabilidad = 'contactado'` — las filas con resultado "pendiente" se **excluyen**, porque no son rechazos, son intentos donde nunca se logró hablar con el cliente. Meterlas como negativos le enseñaría al modelo la mentira de que "no contestar el teléfono" es lo mismo que "no le interesó el producto".

**Modelo B — Contactabilidad.** Responde "¿vamos a lograr hablar con este cliente por este canal?". Se entrena sobre el historial completo, con features de cliente, canal y mes — pero **sin ninguna feature de la oferta**, porque contactar a alguien no depende de qué se le vaya a ofrecer.

Ambos son modelos de LightGBM (gradient boosting sobre árboles), elegidos porque:
- Entrena en segundos incluso con cientos de miles de filas — importante para una demo con tiempo limitado.
- Da contribuciones de features nativamente (`pred_contrib=True`), sin necesitar la librería `shap` — que la ficha del desafío pidió explícitamente no usar, y que además sería sobreingeniería para este volumen de datos.
- Maneja bien variables categóricas y numéricas mezcladas sin preprocesamiento pesado.

### 5.3 — Por qué el split es temporal, no aleatorio

Los datos se dividen así (`pipeline/src/config.py` y `pipeline/src/modelos.py`):

```
Entrenamiento:  hasta 2026-03-31
Validación:     abril 2026 (para early stopping)
Prueba:         desde 2026-05-01
```

Un split aleatorio (mezclar todas las filas y tomar un porcentaje al azar para test) pondría al **mismo cliente** en entrenamiento y en prueba a la vez, porque cada cliente aparece en promedio 3.2 veces en el historial. El modelo "memorizaría" al cliente en vez de aprender un patrón generalizable, y las métricas de prueba saldrían artificialmente altas — un espejismo. El split temporal simula la situación real: entrenar con el pasado, evaluar contra el futuro que el modelo nunca vio.

### 5.4 — La auditoría de fuga de datos (data leakage)

Hay cinco columnas del historial que **se conocen recién después de que el evento ya ocurrió**: `resultado`, `motivo_rechazo`, `es_rebate`, `contactabilidad`, `medio_probatorio`. Usarlas como *features* de entrada sería hacer trampa — el modelo "vería el futuro". El pipeline tiene una verificación explícita en código (`pipeline/src/dataset.py`, función `matriz_X`) que lanza un error si alguna de esas columnas aparece entre las variables de entrada, y además **aborta automáticamente si el AUC de prueba supera 0.90** — porque, dado el Hallazgo 1 (el techo de predictibilidad es bajo), un AUC tan alto solo se explicaría por una fuga no detectada.

### 5.5 — Por qué se regularizó el modelo (y qué significa el número final)

La primera versión del Modelo A, entrenada con los hiperparámetros por defecto de LightGBM, dio un resultado que parecía bueno pero era una trampa: AUC de 0.74 en entrenamiento contra solo 0.58 en prueba. Esa diferencia tan grande (0.16) es la firma clásica de **sobreajuste** (overfitting) — el modelo memoriza detalles específicos de los clientes de entrenamiento en vez de aprender un patrón que generalice.

Se ajustaron los hiperparámetros (tasa de aprendizaje más baja, menos hojas por árbol, más datos mínimos por hoja, regularización L2, muestreo de filas y columnas) para forzar al modelo a generalizar. El resultado final:

| Métrica | Modelo A (Aceptación) | Modelo B (Contactabilidad) |
|---|---|---|
| AUC de prueba | **0.5883** | 0.5033 |
| AUC de entrenamiento | 0.6112 | 0.5430 |
| Diferencia (señal de sobreajuste) | 0.023 (sana) | 0.040 (ruido sobre ruido) |
| Baseline de una sola variable | 0.5635 | 0.4984 |
| Aporte real sobre el baseline | **+0.0248** | +0.0049 (nulo) |
| Brier score, sin calibrar | 0.2229 | 0.1291 |
| Brier score, **calibrado** | **0.2229** | 0.1292 (sin cambio) |
| Brier de predecir siempre la tasa base | 0.2343 | 0.1291 |
| Lift del decil superior | **1.79×** | 1.0× (nulo) |
| Árboles (early stopping por logloss) | 56 | 8 |

**Cómo se lee esto honestamente:** el modelo de aceptación no es un modelo espectacular en términos de AUC absoluto — pero eso es correcto, dado que el techo de estos datos es bajo (Hallazgo 1). Lo que importa es que aporta un margen real (+0.024) sobre la regla ingenua de "¿es MT o no?", que ese margen es consistente con las otras señales encontradas en el EDA (mora, antigüedad), y que la brecha entre entrenamiento y prueba es pequeña — el modelo generaliza, no memoriza. El **lift de 1.79× en el decil superior** significa algo muy concreto para el negocio: si un asesor prioriza llamar primero al 10% de clientes que el modelo rankea más alto, la tasa de conversión de ese grupo es 79% mayor que la tasa promedio. Esa es la cifra que efectivamente mueve una operación de venta, más que el AUC.

El **Brier score** mide qué tan bien calibradas están las probabilidades (0 es perfecto, 0.25 es lo que daría "siempre digo 50%"). Se reporta porque esa probabilidad se le muestra literalmente al asesor en la pantalla — un modelo mal calibrado sería peor que no mostrar ninguna probabilidad, porque generaría falsa confianza.

#### El modelo rankeaba bien y mentía con los números

Esa última frase describía una intención que el propio pipeline no cumplía, y se descubrió mirando la pantalla en dos tandas.

**Primer síntoma: el valor estaba mal.** La cola mostraba "51% de probabilidad" para las ofertas de Movistar Total, cuando la tasa de aceptación **medida** sobre el historial de clientes contactados es del **69.7%**. Veinte puntos de diferencia en un número que el asesor le dice al cliente en voz alta.

**Segundo síntoma: el valor era uno solo.** Tras corregir lo anterior con calibración, un usuario recorrió 25 páginas de la cola y todas mostraban el mismo porcentaje. No era percepción: **11,740 clientes compartían exactamente la misma probabilidad**, y en toda la planta había solo 38 valores distintos. Un ranking donde doce mil prospectos son indistinguibles no está analizando prospectos.

Las dos cosas tenían la misma causa raíz, y vale la pena nombrarla porque es una trampa clásica: el entrenamiento usaba `metric: "auc"` para el early stopping. **El AUC es una métrica de orden** — mide si los positivos quedan por encima de los negativos y es ciega tanto al *valor* de la probabilidad como a su *resolución*. Se satura apenas el modelo aprende la regla gruesa (¿la oferta es MT?), así que cortaba en **9 árboles**. Nueve árboles con `learning_rate` 0.05 producen predicciones pegadas a la tasa base (de ahí el 51%) y tan pocas combinaciones de hojas que miles de clientes caen en el mismo score (de ahí la uniformidad). Las señales débiles que el EDA sí encontró —mora, antigüedad, consumo— nunca llegaban a entrar al modelo.

La corrección tiene dos piezas que se reparten el trabajo:

1. **El early stopping pasa a mirar `binary_logloss`**, que premia afinar la probabilidad de cada caso y no solo el orden global. El modelo entrena 56 árboles en vez de 9, y las señales débiles entran: el AUC de prueba incluso sube (0.5874 → 0.5883) y la brecha train/test sigue sana (0.023). El resultado visible es que ahora los grupos se distinguen por razones legibles — el tope de la cola (76.4%) son clientes con 148 meses de antigüedad, 1.8 días de mora y 0.07 reclamos promedio; el escalón siguiente (72.9%) tiene 102 meses, 4.1 de mora y 0.31 reclamos. Eso es el análisis de prospectos expresado en el número.

2. **La isotónica sobre validación queda como garantía de honestidad del valor**, con una regla extra: ningún nivel del calibrador se sostiene con menos de **30 casos** de evidencia (el mismo umbral de "confianza baja" que usa la matriz de rebate). Sin esa regla, la isotónica pura hacía algo indefendible en la cola alta: los 20 casos de validación con mejor score aceptaron todos, y el calibrador mapeaba ese tramo a **100% literal** — "aceptación garantizada" estimada sobre 20 casos. Los niveles flacos se fusionan con su vecino, y el costo es de dos diezmilésimas de AUC (0.5883 → 0.5881 calibrado, por los empates que crea la fusión): el precio de negarse a prometer certezas.

El resultado, contra las tasas reales del historial:

| | Con el defecto | Ahora | Tasa real medida |
|---|---|---|---|
| Ofertas Movistar Total (promedio) | 49.5% | **69.5%** | 69.7% |
| Resto del portafolio | 36.2% | **34.3%** | 34.1% |
| Valores distintos de probabilidad (recomendación #1) | 38 | **111** | — |
| Clientes empatados en el valor máximo | 11,740 | **958** | — |

El calibrador se guarda como JSON (`pipeline/artifacts/calibrador_aceptacion.json`) y no como un binario serializado, deliberadamente: sus puntos de quiebre se leen a ojo, así que el mapeo score→tasa queda auditable en vez de escondido dentro de un pickle atado a una versión de scikit-learn.

**El modelo de contactabilidad no se calibra**, y la razón es interesante: al no tener ninguna señal, sus predicciones ya se quedaron pegadas a la tasa base (~0.848 real), o sea que está bien calibrado por accidente. Aplicarle la isotónica no movió su Brier (0.1291 → 0.1292), lo que confirma el diagnóstico del Hallazgo 2 desde otro ángulo.

#### ¿Y un 70% de aceptación es creíble?

No para venta telefónica del mundo real, y conviene decirlo antes de que lo pregunten. Contra las referencias de la industria:

| Escenario | Tasa típica |
|---|---|
| Llamada en frío B2B (marcada → reunión) | 2–3%, élite 8–10% |
| Cross-sell / upsell a clientes existentes | 10–30% |
| Upsell de alto rendimiento con oferta complementaria | 15–25% |
| **Este dataset (MT, sobre contactados)** | **69.7%** |
| Este dataset (resto del portafolio) | 34.1% |

La comparación justa no es contra la llamada en frío: acá el cliente **ya es de la casa**, la métrica es condicional a que ya se logró contactarlo, y la oferta le ahorra S/109 al mes. El piso legítimo es el de cross-sell — y aun así el dataset queda 2–4× por encima de su techo.

Lo importante es de quién es ese optimismo: **del generador sintético del desafío, no del modelo**. El modelo predice 69.4% donde el historial mide 69.7%, y esa coincidencia es precisamente la evidencia de que está calibrado y no inflado. Reportar 20% "porque suena más realista" sería inventar una cifra que contradice los datos entregados — exactamente lo que el proyecto no hace.

Sobre datos reales de Movistar, la corrección es automática: la calibración isotónica se ajusta contra el historial que reciba, así que devolvería las tasas reales sin tocar una línea de código. Esa propiedad es el argumento de fondo — no defendemos el 70%, defendemos que la arquitectura reporta lo que los datos digan.

Todo esto está visible en la pantalla de Supervisión, dentro de la tarjeta de transparencia del modelo, y en `metrics.json` bajo `contexto_realismo`.

*Fuentes de los benchmarks: [martal.ca](https://martal.ca/cold-call-statistics-lb/), [saleshive.com](https://saleshive.com/blog/b2b-sales-cold-calling-benchmarks-teams-2025), [apollo.io](https://www.apollo.io/insights/whats-the-average-conversion-rate-for-cold-prospecting), [opensend.com](https://www.opensend.com/post/upsell-cross-sell-take-rate-statistics-ecommerce), [kpidepot.com](https://kpidepot.com/kpi/upsell-cross-sell-conversion-rate).*

**El límite honesto**: aún quedan ~7,000 clientes que comparten el 72.9% exacto. No es un defecto a corregir — son clientes que, a la resolución que estos datos sintéticos permiten, tienen el mismo perfil de riesgo, y asignarles números distintos sería fabricar precisión. Lo que separa a dos prospectos con la misma probabilidad es el resto del análisis: su `gap_a_mt`, su ahorro concreto en soles, su persona y su historial — que es exactamente lo que la cola usa para desempatar y lo que el cockpit muestra al abrirlos.

Un efecto secundario que vale documentar: al ensancharse la separación entre MT (0.69) y el resto (0.34), varios cientos de clientes que tenían su oferta de blindaje fuera del top 6 que el pipeline persiste (`TOP_N` en `pipeline/src/scoring.py`) pasaron a entrar en él, así que la cola con foco MT creció de 56,894 a 57,304 clientes. No es una regresión: son clientes cuya mejor oportunidad de convergencia antes quedaba fuera del corte.

### 5.6 — Segmentación: clustering + capa de reglas

La ficha pide clustering explícitamente. Se implementó en dos capas (`pipeline/src/segmentacion.py`):

1. **K-means** sobre variables de comportamiento (consumo de datos, voz, SMS, uso de la app, facturación histórica, mora, reclamos, actividad de canal, antigüedad), probando *k* entre 5 y 8 y seleccionando por *silhouette score* (una métrica que mide qué tan bien separados y compactos quedan los grupos). El pipeline eligió **k=6**.
2. **Capa de reglas interpretable** encima: cada cluster recibe un nombre de negocio y una descripción generada automáticamente a partir de su perfil estadístico (por ejemplo, "Convergente Dormido" para el grupo con móvil y hogar por separado pero sin blindaje MT, o "En Riesgo de Cobranza" para el grupo con mora alta).

La razón de separar en dos capas: el clustering puro te da un número (`cluster_id = 3`), que no le sirve de nada a un asesor con el cliente en la línea. La capa de reglas es lo que hace que el segmento sea *accionable* — un asesor puede leer "Convergente Dormido: tiene móvil y hogar por separado, consumo alto y sin mora. No se le ha ofrecido convergencia" y entender inmediatamente qué hacer.

### 5.7 — La matriz de rebate empírica

Como se explicó en el Hallazgo 3, la matriz de rebate se calcula sobre recuperación secuencial, no sobre la columna `es_rebate` (que es ruido). El resultado tiene dos capas, separadas deliberadamente:

- **Capa empírica**: para cada motivo de rechazo, qué acción posterior (bajar precio, pivotar a MT, ofrecer algo de precio similar, reintentar por otro canal) tuvo mejor tasa de recuperación, con su tamaño de muestra (`n`) y un nivel de confianza (`alta` si n≥30, `baja` si es menor).
- **Capa de reglas de negocio**: qué acciones son *coherentes* con la naturaleza de cada motivo, independientemente de lo que digan los números. Por ejemplo, si un cliente rechaza porque "no confía", ofrecerle un descuento probablemente empeora la objeción — aunque los datos mostraran una tasa de conversión decente para esa combinación, la matriz **no la recomienda**, porque no tiene sentido de negocio.

| Motivo del rechazo | Naturaleza | Palanca correcta |
|---|---|---|
| Precio | Precio | Bajar de tier, o pivotar a MT (que resultó más efectivo que bajar precio directamente) |
| Ya tiene algo similar | Información | Aclarar el diferencial, no descontar |
| No lo necesita | Encaje | La oferta estaba mal elegida — recomendar otra |
| No confía | Confianza | Construir respaldo, no descontar |
| Mal momento | Timing | No es sobre el producto — reprogramar el contacto |
| Otro | — | Sin acción específica |

Un hallazgo curioso de esta matriz, que terminó siendo un argumento fuerte para el copiloto: en los datos, **pivotar a Movistar Total recupera mejor que bajar el precio para casi todos los motivos de rechazo** — consistente con el Hallazgo 1 de que MT es, con diferencia, lo que mejor convierte.

### 5.8 — Scoring masivo: por qué no hay inferencia en tiempo real

El pipeline no espera a que un asesor abra la ficha de un cliente para calcular su recomendación. En el paso de `scoring`, se calcula de antemano la probabilidad de aceptación y de contacto para **cada combinación válida de cliente × oferta elegible × canal** — aproximadamente 1.37 millones de pares — y el resultado completo se guarda en Postgres.

Esto significa que cuando el asesor (o el copiloto) pregunta "¿y si le ofrezco el tier Básico en vez del Plus?", la respuesta es una consulta a una tabla ya calculada (`SELECT`), no una llamada al modelo. Es una decisión de diseño explícita para que la interfaz responda al instante bajo presión de tiempo, y para simplificar la arquitectura de producción — no hace falta servir el modelo en tiempo real, solo Postgres.

La elegibilidad (`pipeline/src/elegibilidad.py`) se calcula antes del scoring: no tiene sentido ofrecerle una oferta MT a alguien que no cumple los requisitos, ni un plan que ya tiene, ni un downgrade que no aporta valor. Con 22 ofertas del catálogo, esto es literalmente un problema de **ranking sobre un conjunto pequeño y filtrado** — no un problema de recomendación con "sparsity" que necesitaría factorización matricial o embeddings (deliberadamente se evitó esa sobreingeniería).

### 5.9 — La política de desempate: cuando el modelo no distingue, decide el negocio

Un descubrimiento del EDA (los tres tiers de Movistar Total convierten prácticamente igual — 69.6%, 70.2%, 69.3%) generó un problema práctico: con un modelo cuyo AUC es 0.587, las diferencias de valor esperado menores a 0.01 entre dos ofertas son estadísticamente ruido, no señal real. Si el ranking simplemente ordenara por valor esperado exacto, el resultado sería casi arbitrario entre esas ofertas empatadas — y en las primeras versiones, esto llevó a errores reales: un cliente terminaba con una recomendación #1 que le costaba S/0.10 más al mes, mientras otro cliente con perfil casi idéntico quedaba con una oferta que le ahorraba S/89.90, simplemente por el orden accidental de las filas.

Se implementó una **política de ranking explícita** (documentada como tal, no escondida) que rompe los empates técnicos con criterio de negocio, en este orden de prioridad:

1. **`avanza_a_mt`** — ¿la oferta es Movistar Total, o es el "producto puente" que cierra el gap de este cliente hacia MT? Esto tiene prioridad porque es la razón de ser del proyecto: blindar la planta.
2. **Nunca un downgrade como jugada proactiva** — un plan móvil más barato que el actual puede "ganar" por desempate de ahorro, pero bajar el ARPU (ingreso promedio por usuario, uno de los indicadores que la ficha pide mejorar) no es una jugada de venta proactiva, es una palanca de retención que se usa en otro contexto.
3. Solo después de estos dos criterios, se desempata por el valor esperado exacto, luego por el ahorro en soles, luego por precio.

Esto es importante de entender conceptualmente: **la política no anula al modelo**. Si el modelo encuentra una diferencia real (≥0.01 de valor esperado), esa diferencia gana y el modelo decide. La política solo entra a resolver los casos donde el modelo, honestamente, no tiene opinión — y ahí, en vez de dejarlo al azar del orden de las filas, decide la estrategia comercial del desafío.

### 5.10 — Abstención: cuándo el sistema se niega a vender

Uno de los dolores que la ficha declara explícitamente es el "riesgo de ofrecer productos poco adecuados". Se implementó como una regla dura, no como una sugerencia: si un cliente tiene `meses_moroso >= 3` o `n_reclamos >= 4`, el sistema **no genera ninguna recomendación de venta**. En su lugar, marca `abstenerse: true` con el motivo explícito, y la interfaz completa cambia de modo — la columna central del cockpit, donde normalmente aparece la oferta recomendada, se convierte en una alerta de retención/cobranza, y hasta los atajos rápidos del copiloto cambian de "dame el speech de venta" a "¿por qué no puedo ofrecerle nada?".

Es una decisión de producto deliberada: **la herramienta no le da al asesor ningún camino para "vender igual"** a un cliente que probablemente no debería recibir una oferta comercial en ese momento — ofrecerle algo a alguien con mora activa puede empeorar la relación y la probabilidad de cobro.

---

## 6. El copiloto conversacional: la pieza que más esfuerzo de pulido llevó

La ficha pide explícitamente "IA generativa para construir argumentos comerciales, mensajes y speech de rebate personalizados" y un "asistente virtual/inteligente para asesores". Esta fue la pieza donde se invirtió más cuidado, porque es la que el asesor va a usar constantemente en llamada.

### 6.1 — Arquitectura: proveedor intercambiable

Todo el acceso a modelos de lenguaje pasa por un único módulo, `web/src/ai/provider.ts`. Ningún otro archivo del proyecto importa un SDK de proveedor de IA directamente. Esto significa que cambiar de Gemini a Claude o a OpenAI es cambiar dos variables de entorno (`AI_PROVIDER`, `AI_MODEL`), no tocar una línea de lógica de negocio. Se construyó sobre el Vercel AI SDK (`ai`), que da una interfaz uniforme de streaming y tool calling sobre distintos proveedores.

La razón de este aislamiento no es solo elegancia técnica: es una protección contra quedar atado a la disponibilidad o el precio de un solo proveedor durante un evento en vivo, donde la cuota gratuita de un modelo puede agotarse en el peor momento.

### 6.2 — El loop de tool calling y por qué corre en el servidor

Cuando el asesor le pregunta algo al copiloto, ocurre lo siguiente (`web/src/app/api/copiloto/chat/route.ts`):

1. El mensaje viaja al servidor (nunca al navegador directamente al proveedor de IA — la clave API del proveedor **nunca llega al cliente**).
2. El servidor arma un *system prompt* (`web/src/ai/prompt.ts`) con las reglas duras: nunca inventar cifras, no decidir ofertas por cuenta propia, respetar la abstención, hablar en español peruano neutro y directo.
3. El LLM recibe el mensaje junto con la lista de diez *tools* disponibles y decide, por su cuenta, cuáles necesita llamar para responder — por ejemplo, para "¿qué le ofrezco a este cliente?" normalmente llama `get_cliente` y `get_nbo` en paralelo, y a veces `get_journey` para no repetir una oferta ya rechazada.
4. Cada tool ejecuta una consulta real a Postgres (por las mismas funciones que usa la interfaz) y devuelve el resultado al LLM.
5. El LLM traduce esos resultados a una respuesta en lenguaje natural, con streaming — el texto va apareciendo palabra por palabra, no se espera a que termine todo el razonamiento.

Este loop puede repetirse hasta 6 pasos (`stepCountIs(6)`) antes de forzar una respuesta final, para evitar que el copiloto entre en un ciclo de llamadas.

### 6.3 — Por qué los tool calls se muestran en vivo en la interfaz

Cada vez que el copiloto llama a una tool, la interfaz muestra un pequeño indicador visual ("consultando recomendación...") que luego se funde a un check verde con un resumen ("✓ get_nbo: 6 recomendaciones, top OF020"). Esto no es decoración — es la manifestación visible del principio arquitectónico central. Sin esos indicadores, el asesor vería solo texto fluido apareciendo en pantalla, indistinguible de un modelo que estuviera improvisando. Con ellos, queda claro en tiempo real que cada afirmación tiene una consulta a datos reales detrás.

Antes del primer tool call o del primer token de texto puede pasar más de un segundo — el tiempo que tarda el proveedor de IA en empezar a responder. La primera versión de la interfaz no tenía ninguna señal en ese hueco: el único indicio de que algo estaba pasando era el spinner del botón de enviar, a varios cientos de píxeles del área donde va a aparecer la respuesta. Se agregó un indicador de "pensando" (tres puntos con animación de respiración) exactamente en el lugar donde va a aparecer el primer chip o el primer texto, para que el asesor nunca se pregunte si el copiloto recibió su pregunta.

### 6.4 — Las reglas duras del system prompt

El prompt del sistema (`web/src/ai/prompt.ts`) no es una sugerencia de tono — codifica restricciones de negocio específicas:

- **Ninguna cifra sin tool.** Ya explicado como principio central.
- **No decide ofertas.** Si el asesor pregunta por una oferta que no está en el ranking del modelo, el copiloto la evalúa con `evaluar_oferta` y explica honestamente por qué no es la recomendación #1 — no la promueve por su cuenta.
- **Respeta la abstención.** Si `get_nbo` devuelve `abstenerse: true`, el copiloto no arma ningún argumentario de venta.
- **La ruta a Movistar Total se vende completa, nunca a medias.** Cuando un cliente no es elegible directamente, el "producto puente" que lo acerca a MT (por ejemplo, contratar internet hogar) en general *aumenta* su factura en el corto plazo. El prompt prohíbe explícitamente mencionar el paso 1 sin el paso 2 y su ahorro proyectado — decir solo "esto lo acerca a Movistar Total" sin cifras sería, en la práctica, regalar la venta.
- **Un ahorro negativo nunca se presenta como "ahorro".** Si una oferta cuesta más de lo que el cliente paga hoy, el copiloto dice "S/40 más al mes", nunca dilluye ese dato en un "ahorro de -S/40" que un asesor podría leer mal en el apuro.
- **Nada de humor en los speeches.** El asesor puede estar en una llamada grabada con medio probatorio — el tono es directo y profesional, sin adornos.
- **Español peruano neutro, directo, sin relleno.** El asesor tiene al cliente esperando; cada palabra decorativa cuesta tiempo real.
- **La lectura es suya; la cifra, no.** La prohibición es sobre inventar números, no sobre pensar. Sin esta contrapartida explícita, un prompt hecho sólo de prohibiciones produce un modelo que juega a la defensiva: volcaba la ficha del cliente como una lista de veinte campos crudos y dejaba el juicio al asesor, que es exactamente lo que no tiene tiempo de hacer con el cliente en la línea. Ahora responde con lectura → veredicto → evidencia → acción, y descarta los datos que no cambian la decisión.

### 6.4 bis — Preguntas sobre grupos, no sobre un cliente

Ocho de las diez tools reciben un `cliente_id`, porque el motor está construido para armar el argumento de una atención concreta. Pero el asesor también pregunta por el colectivo —"¿y qué me puedes decir de los clientes de este rango de edad?"— y hasta que existió `analizar_segmento` el copiloto sólo podía contestar "no tengo ese dato" sobre datos que sí estaban en la base: no había ninguna consulta agregada en vivo en todo el backend, sólo los tres artefactos que el pipeline congela para la pantalla de supervisión.

`analizar_segmento` filtra la planta por diez atributos combinables (edad, departamento, tipo, cluster, gap a MT, salud, canal, elegibilidad, MT, uso de app) y devuelve tamaño, perfil promedio, cobertura de MT, salud, personas, las ofertas que el motor más recomienda y la conversión histórica medida. Sin filtros, la planta entera.

Dos decisiones que importan más de lo que parece:

- **Todo conteo viaja con su porcentaje.** No es cosmética: si el copiloto tuviera que dividir para obtener el porcentaje, estaría produciendo una cifra que ningún tool le dio, que es justamente la regla que el proyecto no cruza. Lo mismo con la comparación cliente↔grupo: cita las dos cifras tal como vinieron ("paga S/ 259.80; el promedio de su rango es S/ 122.57") y califica la diferencia en palabras, sin restarlas.
- **Medido y proyectado no se mezclan.** `conversion_historica` sale del historial real de ofrecimientos; `oportunidad` es lo que el modelo recomendaría hoy. La nota metodológica viaja dentro de la respuesta, no sólo en la documentación, porque el que tiene que respetarla es el modelo.

### 6.5 — Validación de entrada del endpoint público

El endpoint del copiloto (`/api/copiloto/chat`) es público — no tiene autenticación, por decisión de producto para esta demo. Pero sí valida con Zod que cada request tenga como máximo 40 mensajes y cada mensaje como máximo 8,000 caracteres. Esto no es una medida de seguridad contra ataques — es protección contra que un bucle accidental del frontend, o un usuario pegando un documento entero, terminen quemando la cuota gratuita del proveedor de IA o colgando un request indefinidamente.

---

## 7. La interfaz: diseño para un asesor bajo presión de tiempo

### 7.1 — Por qué tres pantallas, y no más ni menos

La interfaz se organizó en tres pantallas, cada una respondiendo a un momento distinto del trabajo:

**Cola de atención (`/`)** — la bandeja de trabajo. Es la pantalla de entrada: qué clientes atender primero, ordenados por valor esperado de la mejor oportunidad, con filtros por foco (blindaje MT vs. todo el portafolio), canal, y un filtro específico para "nunca se le ofreció MT" — que ataca directamente la cobertura perdida (los clientes elegibles que el sistema nunca les presentó la oferta). Incluye un buscador por ID de cliente, porque en Call In o Tienda el cliente llega primero y el asesor tiene que ubicarlo, no esperar a que aparezca en la cola.

La cola está **paginada de a 50 y muestra siempre el total** ("Mostrando 1–50 de 57,304"). Las dos cosas se agregaron por el mismo motivo, y no es de comodidad: la primera versión mostraba 50 clientes fijos, sin paginación y sin decir cuántos había detrás. Como los primeros puestos de un ranking son por definición parecidos entre sí —y con las probabilidades sin calibrar eran directamente idénticos— la pantalla se leía como un dataset recortado o inventado, en vez de como el techo de una cola de 57 mil. Poder avanzar y ver que en la página 800 las cifras son otras es lo que demuestra que los datos son reales.

Paginar obligó además a cerrar un bug latente: el orden de la cola no era **total**. Hay grupos de una docena de clientes con las tres claves de ordenamiento idénticas, y SQL no garantiza en qué orden los devuelve; con un `LIMIT` fijo daba igual, pero paginando sobre un orden inestable un cliente puede aparecer en dos páginas o no aparecer en ninguna. El `ORDER BY` termina ahora desempatando por `cliente_id`.

**El cockpit (`/clientes/:id`)** — la pantalla donde realmente ocurre la atención. Diseñada bajo la restricción de "una sola pantalla, sin navegación, con zonas de scroll independiente":

- *Izquierda: quién es el cliente.* El segmento (buyer persona) con su nombre y descripción, la ficha con el dato clave ("paga realmente S/X al mes" contrastado contra "en pantalla figura S/Y"), el estado de salud (con semáforo de mora y reclamos), y la línea de tiempo completa de ofrecimientos pasados con su resultado, motivo de rechazo y medio probatorio.
- *Centro: qué ofrecer.* La recomendación #1 como tarjeta principal, con el ahorro en soles como cifra protagonista (no un porcentaje genérico), la probabilidad de aceptación como barra visual, los factores que juegan a favor y en contra separados explícitamente (nunca mezclados, para que un factor negativo no se use por error como argumento de venta), la ruta a MT en dos pasos cuando aplica, y **seis botones de objeción** de un solo click ("Está caro", "No confía", etc.) que traen al instante las tácticas con su tasa medida — el asesor elige cuál usar, no se le impone la de mayor tasa, porque conoce el tono de la llamada mejor que el historial agregado.

El copiloto ya no es una tercera columna fija: es un **panel flotante global** (ver 7.1 bis), disponible sobre esta pantalla y sobre las otras dos. Arriba del contenido hay un **selector de canal** ("Atendiendo por: Tienda / Call In / Call Out / Digital") que re-rankea la recomendación en vivo usando las probabilidades ya precalculadas para ese canal — simula el escenario real de "el cliente ya está frente a mí en la tienda, ¿qué le ofrezco *aquí*?".

### 7.1 bis — El copiloto como capa flotante, no como columna

La primera versión del copiloto era una columna fija de 340px dentro del cockpit, visible solo en pantallas anchas (≥1280px) — por debajo de eso, colapsaba y dejaba de ser usable. Y solo existía ahí: en la cola o en supervisión, el asesor no tenía forma de preguntarle nada.

Eso contradecía la premisa del proyecto. En producción, este copiloto no sería una pantalla aparte — sería una capa montada **encima** del sistema que el asesor ya usa (DITO para venta, Visor para postventa), disponible sin importar en qué pantalla de esa herramienta esté parado. Una columna fija dentro de una sola ruta no puede demostrar esa idea; un panel flotante sí.

El copiloto se rediseñó como una burbuja que se expande a un panel anclado a la derecha (`web/src/components/copiloto/PanelFlotante.tsx`), montado una sola vez en el layout raíz vía un contexto de React (`CopilotoProvider.tsx`) que envuelve a `children` — como `children` llega como prop ya renderizada en el servidor, envolverla así no convierte las páginas en client components, y el panel queda disponible en las tres rutas sin que cada una tenga que saber que existe. Dos consecuencias de que viva en el layout en vez de en el cockpit:

- **La conversación sobrevive a la navegación.** El layout no se remonta al cambiar de página, así que preguntar algo en la cola y después entrar a un cliente no reinicia el chat — solo lo hace entrar a un cliente *distinto* del que ya estaba en contexto, que es la regla que ya existía.
- **El cockpit solo informa, no controla.** Le pasa al contexto quién es el cliente en atención y su estado (`abstenerse`, `tieneRutaMt`) por un efecto; el panel decide con eso si debe abrirse solo (arranca expandido al entrar a un cliente) o quedarse como burbuja (en la cola y en supervisión, donde no hay nadie en atención).

Sin cliente en contexto, los atajos del copiloto cambian a preguntas de planta ("¿a quién llamo ahora?", "¿cómo está la planta para Movistar Total?"), apoyadas en `proximos_clientes` y `analizar_segmento` — las mismas tools que usaría un supervisor, no las de argumento de venta que no tienen sentido sin un cliente delante.

**Supervisión (`/supervision`)** — no es para el asesor, es para quien tiene que responder por el sistema (un supervisor, o el jurado). Muestra el funnel E2E completo (ofrecimientos → contactados → con medio probatorio → aceptados), los KPIs de participación de MT contra las metas declaradas en la ficha (50% de venta hogar, 10% de venta móvil), el mercado alcanzable, y una tarjeta de transparencia del modelo que expone honestamente sus limitaciones — el AUC, el baseline de comparación, y una nota explícita de que la contactabilidad no es predecible en estos datos.

### 7.2 — Decisiones de diseño visual

La primera versión de la estética era "neutra moderna" con un acento índigo genérico, deliberadamente sin branding — para no imitar assets de marca sin tenerlos. Se reemplazó por una identidad Movistar explícita (header azul marino oscuro, acento en el azul de marca, tipografía geométrica-humanista vía `next/font`) porque, con el copiloto ya funcionando como capa flotante sobre la herramienta del asesor (ver 7.1 bis), tenía sentido que también *se viera* como una herramienta interna de la compañía y no como una demo genérica de IA.

El azul de marca (`#019DF4` aproximado) no se usa como color de texto: da un contraste de ~2.6:1 sobre blanco, insuficiente para AA. Por eso el sistema define dos tonos separados — `marca` para superficies grandes donde el color es la identidad (el logo, el header, la burbuja del copiloto) y `acento`, más profundo, para todo lo que se lee o se pulsa (links, botones, estados activos), a ~5:1 de contraste. Confundir los dos tokens rompería la accesibilidad de texto en cualquier componente que los intercambiara.

Algunas reglas de diseño aplicadas de forma consistente:

- **Las cifras que un asesor va a decir en voz alta van grandes y con su unidad explícita** (nunca un número pelado). El ahorro en soles usa figuras proporcionales (no tabulares) para que se lea como una cifra destacada, mientras que las columnas de tabla usan `tabular-nums` para que los dígitos se alineen verticalmente.
- **Cuando un dato es un promedio de segmento y no del cliente individual, se etiqueta explícitamente** ("cifras promedio del segmento, no de este cliente") — se descubrió durante las pruebas que la descripción del cluster podía confundirse con un dato del cliente puntual, y un asesor leyendo esa cifra en voz alta al cliente equivocado sería un error real.
- **De dónde sale cada sugerencia se muestra, no se esconde.** El canal sugerido lleva una etiqueta ("preferencia observada" vs. "estimado por el modelo" vs. "seleccionado por ti"), consistente con el Hallazgo 2: no se presenta como predicción algo que no lo es.
- **Los gráficos del panel de Supervisión siguen un sistema de color validado**, no elegido a ojo — se usó una rampa de un solo tono para el funnel (porque las etapas tienen orden natural, tokenizada en el hue de marca en vez de hex sueltos en el componente), colores distintos por identidad solo donde hace falta distinguir categorías sin orden (los motivos de rechazo), y se corrió un validador automático de accesibilidad de color (contraste, daltonismo) antes de aceptar la paleta final.
- **Los controles interactivos comparten una sola primitiva** (`web/src/components/ui/Button.tsx`: `Button` y `Segmentado`). Antes, el mismo patrón de "grupo de opciones excluyentes" estaba reescrito a mano en cuatro archivos distintos, con hovers que ya habían divergido entre sí sin que nadie lo hubiera decidido — síntoma típico de copiar-pegar un componente en vez de extraerlo. La primitiva también es donde vive el único lugar que necesita llevar el detalle de que un botón se "presione" (`active:scale-[0.97]`) y el anillo de foco para quien navega con teclado, que antes no existía en ningún botón de la app.

### 7.3 — Bugs reales que la implementación destapó (y qué enseñan)

Vale la pena documentar algunos errores concretos que aparecieron al construir y probar el sistema de punta a punta, porque revelan por qué ciertas decisiones de diseño existen:

- El texto comercial del catálogo tenía el número "9999" (el centinela de "ilimitado") incrustado literalmente en la descripción ("Movistar Total Max - 9999GB - S/229.9"). Se había limpiado ese valor en los cálculos numéricos, pero no en el texto — y el copiloto terminó diciéndole a un asesor de prueba "gigas ilimitados (9999GB)", una frase sin sentido que un cliente real habría notado.
- Los "drivers" (explicaciones de por qué el modelo recomienda una oferta) incluían tanto factores a favor como en contra, mezclados bajo el título "Por qué esta oferta" — lo que técnicamente es correcto (el modelo sí pesa ambos sentidos), pero en la interfaz hacía que un asesor pudiera leer un factor negativo como si fuera un argumento de venta. Se separaron en dos listas explícitas.
- La primera versión del ranking en la cola de atención podía poner arriba a un cliente al que ofrecerle MT le costaba S/0.10 *más* al mes, por delante de otro cliente casi idéntico al que le ahorraba S/89.90 — pura consecuencia del Hallazgo de que los tres tiers de MT convierten casi igual, sumado a un desempate mal diseñado. Se corrigió agrupando el valor esperado (redondeado, porque diferencias menores a 0.01 son ruido dado el AUC del modelo) antes de desempatar por ahorro.
- La definición inicial de "participación de MT en la venta móvil" solo contaba `plan_movil` en el denominador, lo que producía un resultado absurdo (50.4% contra una meta de 10%). Se corrigió para contar todo el segmento de venta móvil (planes, upgrades, equipos), y además la interfaz muestra honestamente cuando una meta ya está superada en los datos sintéticos, en vez de forzar una narrativa de "brecha por cerrar" que no corresponde.
- El despliegue en el VPS (Dokploy + GHCR) parecía funcionar — el pipeline de CI terminaba en verde y un "Redeploy" manual devolvía éxito en 0 segundos — pero seguía sirviendo la versión anterior de la app. La causa real eran dos fallas encadenadas: `docker compose up -d` no vuelve a descargar una imagen `latest` si ya tiene una con ese tag en disco (Docker solo hace *pull* cuando la imagen le falta, no cuando cambió en el registry), y el auto-deploy que Dokploy dispara al detectar el push de git corría en paralelo a la construcción de la imagen — llegaba unos 20 segundos antes de que `latest` existiera de verdad. El primer punto era el grave: sin corregirlo, ningún redeploy manual iba a servir nunca, porque "0 segundos" significaba literalmente "no se descargó nada". Se resolvió agregando `pull_policy: always` a los dos servicios en `docker-compose.prod.yml`, y moviendo el disparo del deploy a un paso del propio workflow de CI (`.github/workflows/publicar-imagenes.yml`) que corre *después* de que las imágenes terminan de publicarse, llamando al webhook de Dokploy en vez de depender de su detección de push.

Estos casos no son anécdotas menores — ilustran por qué el proyecto insiste tanto en verificar cada afirmación contra la base de datos real antes de mostrarla, y por qué el copiloto tiene la regla dura de nunca inventar una cifra.

---

## 8. Stack técnico y por qué se eligió

| Pieza | Tecnología | Razón |
|---|---|---|
| Base de datos | PostgreSQL 16 | Requisito del proyecto; robusto, soporta JSONB para los drivers y probabilidades por canal precalculadas |
| Backend + Frontend | Next.js 15 (App Router), un solo servicio | El copiloto necesita streaming SSE y tool calling del lado del servidor — Next.js lo da nativo sin separar en dos servicios. Menos piezas móviles para una demo de 15 horas |
| Pipeline de ML | Python: pandas, LightGBM, scikit-learn, pyarrow | LightGBM entrena en segundos incluso con 300K+ filas; sin necesitar GPU ni infraestructura de MLOps |
| Capa de IA | Vercel AI SDK, con Gemini/Claude/OpenAI intercambiables | Aislamiento del proveedor en un único módulo (ver sección 6.1) |
| UI | Tailwind CSS v4, componentes propios (sin librería de componentes) | Solo 3 pantallas — una librería completa habría sido sobreingeniería; el control fino del layout del cockpit lo pedía |
| Contenedores | Docker Compose (desarrollo) / imágenes separadas (producción) | Reproducibilidad total: un `docker compose up` levanta todo el stack |

Explícitamente se evitó: `shap` (LightGBM da explicabilidad nativa), MLflow/Optuna/Airflow (sobreingeniería para una demo), factorización matricial o embeddings para el motor de recomendación (con solo 22 ofertas, es un problema de ranking simple, no de recomendación con "sparsity").

---

## 9. El contrato de datos: por qué existe como documento separado

Antes de escribir cualquier lógica de negocio, se congeló un documento (`docs/contrato_datos.md`) que define exactamente la forma de cada endpoint de la API — qué campos trae, qué tipos, qué significa cada uno. La razón: una vez que el pipeline, el backend y el frontend pueden avanzar en paralelo sobre un contrato fijo, ningún cambio de uno rompe silenciosamente a los otros. Es, en esencia, aplicar a un proyecto pequeño la misma disciplina que evita integraciones rotas en sistemas grandes: la fuente de verdad está escrita, no en la cabeza de quien escribió el código.

---

## 10. Qué significa "generalizable al portafolio" en este proyecto

La ficha pide explícitamente que el motor de recomendación no sea exclusivo para Movistar Total — que sea aplicable al resto del portafolio de 22 ofertas. Esto se cumple de raíz en el diseño, no como un añadido: el modelo de aceptación se entrena sobre **todo** el historial de ofrecimientos (no solo los de MT), el ranking corre sobre las ofertas elegibles completas para cada cliente, y la política de desempate (sección 5.9) prioriza el blindaje MT solo quando hay empate técnico entre varias ofertas — si un cliente tiene una probabilidad de aceptación claramente más alta para, digamos, un upgrade de plan móvil, esa es la recomendación que aparece primero, no MT por decreto.

MT es el caso de uso *prioritario y medible* del proyecto (por eso tiene su propia ruta de conversión en dos pasos, su propio conjunto de métricas de supervisión, y su propia política de desempate), pero la arquitectura subyacente —modelo de aceptación, modelo de contactabilidad, matriz de rebate, clustering— es agnóstica a qué producto específico se está evaluando.

---

## 11. Resumen de lo que hace que este proyecto sea defendible ante un jurado

Para cerrar, vale la pena nombrar explícitamente los elementos que hacen que este proyecto responda a lo que la ficha del desafío pide, más allá del código:

1. **No se persiguió accuracy, se persiguió honestidad sobre lo que los datos permiten decir.** El AUC de 0.587 se reporta junto a su baseline de comparación (0.564) y su margen real (+0.024), en vez de esconder que el techo es bajo.
2. **Las "variables ingeniosas" pedidas explícitamente en la ficha son el corazón del proyecto**: `gap_a_mt` (que multiplica el mercado alcanzable por 4.6×) y `gasto_actual_total` (que corrige un sesgo real del dato de facturación) no son adornos — cambian el argumento de venta que el asesor usa.
3. **Cuando los datos no dan para algo, se dice explícitamente en vez de simularlo** — la contactabilidad no predecible (Hallazgo 2), el rebate que no se puede calcular con `es_rebate` (Hallazgo 3), y la ausencia de resolución horaria en el historial, todos se documentan y se manejan con reglas transparentes en vez de forzar un modelo que aparentaría funcionar sin funcionar de verdad.
4. **La interfaz está diseñada para el usuario real que la ficha describe** — un asesor bajo presión de tiempo — no para impresionar con un dashboard cargado de gráficos.
5. **El motor es generalizable, no solo un buscador de clientes MT**, cumpliendo el requisito explícito de la ficha.
6. **Cada cifra en pantalla es trazable a una consulta real de base de datos**, tanto en la UI como en el copiloto — la arquitectura misma hace estructuralmente imposible que el LLM invente un número.
