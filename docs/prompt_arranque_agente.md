# Prompt de arranque — Copiloto NBO

**Hackathon AI Telecom Challenge 2026 · Desafío 02: Personalización comercial inteligente**
Organizado por Movistar y Universidad de Lima

> Pegar este documento completo como primer mensaje al agente. Los CSV ya están en la carpeta de trabajo.

---

## 1. Contexto y plazo

Tenemos **15 horas**. Construimos la solución para el Desafío 02 del AI Telecom Challenge 2026.

**El objetivo según la ficha oficial:** diseñar una solución basada en IA que recomiende, de manera inteligente y personalizada, la mejor oferta comercial para cada cliente (Next Best Offer), considerando su perfil, comportamiento, necesidades, historial de consumo y el contexto y canal de atención.

El motor debe identificar:
- El **cliente potencial**
- El **canal** por el que es más propenso a comprar
- El **momento** idóneo
- El **mensaje / oferta** idónea según su necesidad
- La **probabilidad de aceptación**
- El **motivo por el que rechazaría** la oferta, con solución de **rebate**
- **Seguimiento E2E** del ofrecimiento hasta el resultado de venta

Como caso de uso prioritario, la solución debe impulsar **Movistar Total (MT)** como palanca de blindaje de la planta de clientes.

### Contexto de negocio que importa

- MT entrega hasta 50% de ahorro vs. comprar productos por separado. El potencial es **toda la planta móvil y hogar**: ofrecer a cada cliente **el producto que le falta** para convertirse en MT.
- **Meta declarada:** que más del **50% de la venta hogar** y más del **10% de la venta móvil** sea con MT.
- Hoy MT no es la primera opción de ofrecimiento del asesor, y el ofrecimiento es **reactivo** (solo se ofrece si el cliente pregunta).
- Buena parte de la planta (+50 años) es poco digital.
- Plataformas internas: **DITO** (venta) y **Visor** (postventa / cross).
- **Dolor declarado sin resolver:** "no existen reportes unificados ni plataformas automáticas de escucha que permitan identificar si un producto fue efectivamente ofrecido, ni trazar el ofrecimiento de extremo a extremo".
- Otro dolor declarado: "riesgo de ofrecer productos poco adecuados".

### Criterios de evaluación explícitos en la ficha

> "El desafío no consiste únicamente en lograr el algoritmo con el mayor accuracy en el dataset, sino en demostrar cómo ese algoritmo resuelve el problema planteado."

> "Se valorará especialmente la **creación de variables ingeniosas combinando datos** y la **simplicidad para traducir los resultados técnicos a una interfaz limpia, intuitiva y fácil de usar para un asesor bajo presión de tiempo**."

> "Se valorará que el motor de recomendación sea **generalizable a otras ofertas del portafolio**", no solo MT.

Indicadores que se busca mover: tasa de conversión comercial, participación de MT en la venta, ARPU, reducción de churn y mejora de permanencia, NPS.

## 2. Qué construimos

Un **panel de asistencia para el asesor comercial** ("Copiloto NBO"). No es un chatbot para el cliente final: es una herramienta interna que el asesor usa mientras atiende, en Tienda, Call In, Call Out o Digital.

### La conversación con IA es la estrella

La ficha pide explícitamente "IA generativa para construir argumentos comerciales, mensajes y speech de rebate personalizados" y un "asistente virtual / inteligente para asesores". **Esta es la pieza que debe quedar más pulida de todo el proyecto.** El asesor conversa en lenguaje natural con el copiloto: le pregunta qué ofrecer, por qué, qué decir, qué responder ante una objeción, qué pasa si cambia de oferta.

Pero pulir la conversación **no** significa que el LLM decida. Ver el principio arquitectónico abajo — es exactamente al revés: la conversación se siente confiable *porque* todo lo que dice está respaldado por el motor.

### Principio arquitectónico central

> **El modelo decide y es auditable; el LLM explica, argumenta y conversa.**

El LLM no elige ofertas ni estima probabilidades: eso lo hace un modelo supervisado entrenado sobre el historial real. El LLM traduce el output del motor a lenguaje natural, construye el argumentario y adapta el speech.

**Regla dura:** el LLM no puede emitir ninguna cifra (probabilidad, precio, ahorro, tasa de conversión) que no venga de un resultado de tool. Si le falta el dato, lo dice. Esto no es una limitación: en telecomunicaciones reguladas, con trazabilidad y medios probatorios de por medio, ningún sistema puede improvisar cifras frente a un cliente. Es un argumento de venta del proyecto, no una disculpa.

## 3. Cómo interpretar los datos

**Los datos son 100% sintéticos.** Las relaciones que encuentres en el EDA no son verdades sobre clientes reales: son las reglas que un generador inyectó. Esto no invalida nada, pero cambia el propósito del EDA: no es "descubrir insights", es **recuperar la lógica de negocio que el dataset codifica** para modelarla bien. Encaja con lo que pide la ficha: demostrar cómo el algoritmo resuelve el problema, no maximizar accuracy.

Cinco lecturas que definen el proyecto:

### 3.1 `pendiente` no es ruido: es un segundo modelo

Las filas con `resultado = 'pendiente'` / `contactabilidad = 'no_contactado'` deben excluirse del modelo de aceptación (no son rechazos). Pero **son el dato para modelar contactabilidad**, que es lo que responde "por qué canal y en qué momento".

Descomposición central del proyecto:

```
Valor esperado = P(contactar | canal, momento, cliente) × P(aceptar | contactado, oferta, canal)
```

Optimizar el producto de ambas —no solo la segunda— es lo que responde de verdad la pregunta de canal y momento que pide la ficha. Casi todos los equipos van a descartar los `pendiente` como ruido.

### 3.2 `elegible_mt` es el segmento fácil, no el mercado

La ficha dice que el potencial es toda la planta, ofreciendo a cada cliente **el producto que le falta**. Esa columna no existe: hay que derivarla.

- Postpago + móvil, sin internet hogar → le falta **un producto hogar** para ser elegible
- Internet hogar, pero prepago → le falta **migrar a postpago**
- Tiene hogar pero solo TV (`tiene_hogar = True`, `tiene_internet_hogar = False`) → le falta **internet**

Esto define una **ruta de conversión a MT en dos pasos** y amplía el mercado mucho más allá de los ya elegibles. Es la "variable ingeniosa" que la ficha dice que valorará especialmente. Modelarla es prioritario.

### 3.3 El ahorro real se calcula, no se lee

El diccionario advierte que `ahorro_pct` es ilustrativo y sin desglose oficial. Pero con el precio de `plan_actual_id` más el de `oferta_hogar_id` tienes **lo que ese cliente paga hoy por separado**. Contra el precio del tier de MT, sale el ahorro exacto en soles.

Para el speech: "usted paga S/ 214 hoy, con Movistar Total pagaría S/ 189" es incomparablemente más fuerte que "hasta 50% de ahorro" — que es justamente el mensaje genérico que la ficha identifica como problema.

### 3.4 Cada motivo de rechazo pide una palanca distinta

No son seis variantes de "bajar el precio":

| Motivo | Naturaleza de la respuesta |
|---|---|
| `precio` | Único donde mover precio o bajar de tier tiene sentido |
| `ya_tiene_similar` | Problema de **información**: aclarar el diferencial |
| `no_necesita` | Problema de **encaje**: la oferta estaba mal elegida, recomendar otra |
| `no_confia` | Problema de **confianza**: un descuento probablemente empeora |
| `mal_momento` | No es rechazo del producto: es señal de **timing**, realimenta el modelo de contactabilidad |
| `otro` | Sin acción específica |

### 3.5 El catálogo tiene 22 ofertas

No es un problema de recomendación con sparsity. Es un **ranking sobre 22 candidatos**: cross join cliente × ofertas, scorear, ordenar, filtrar por elegibilidad. Nada de factorización matricial ni embeddings — sería sobreingeniería que además rinde peor.

## 4. Los datos

Los tres CSV están en la carpeta de trabajo. 100,000 clientes, 6 meses (enero–junio 2026), sintéticos y anonimizados.

### `dataset_clientes.csv` — 100,000 filas

| Columna | Tipo | Descripción |
|---|---|---|
| `cliente_id` | string (PK) | Identificador único |
| `tipo_cliente` | categórico | prepago / postpago. **Nulo si no tiene línea móvil** |
| `antiguedad_meses` | int | Antigüedad en meses |
| `tiene_movil` | bool | Tiene línea móvil |
| `tiene_hogar` | bool | Tiene algún servicio hogar (internet, TV y/o fijo) |
| `oferta_hogar_id` | string (FK) | Paquete hogar específico. Nulo si `tiene_hogar = False` |
| `tiene_internet_hogar` | bool | Si ese paquete incluye internet. **NO es lo mismo que `tiene_hogar`** |
| `es_movistar_total` | bool | El cliente **ya tiene** MT |
| `elegible_mt` | bool | Cumple requisitos (móvil + internet hogar + postpago) pero **aún no lo tiene** |
| `plan_actual_id` | string (FK) | Plan principal actual |
| `monto_facturado_prom` | float | Monto mensual promedio del plan actual (soles) |
| `edad_rango` | categórico | 18-25, 26-35, 36-45, 46-55, 56-65, 65+ |
| `ubicacion_departamento` | categórico | Departamento |
| `es_usuario_app` | bool | Usó la app en los últimos 3 meses |
| `consumo_datos_gb_prom` | float | GB mensuales promedio |
| `consumo_voz_min_prom` | float | Minutos de voz promedio |
| `consumo_sms_prom` | float | SMS promedio |
| `uso_app_movistar_prom` | float | Sesiones de app promedio |
| `monto_facturado_prom_6m` | float | Promedio facturado histórico (distinto del anterior) |
| `dias_mora_prom` | float | Días de mora promedio por mes |
| `meses_moroso` | int | Meses (de 6) con mora >15 días |
| `n_reclamos` | int | Reclamos totales en 6 meses |
| `n_actividad_canal` | int | Interacciones totales en 6 meses |
| `canal_mas_usado` | categórico | Tienda / Call In / Call Out / Digital. Nulo si no hubo interacciones |

### `catalogo_ofertas_entrega.csv` — 22 filas

| Columna | Tipo | Descripción |
|---|---|---|
| `oferta_id` | string (PK) | Identificador |
| `nombre_oferta` | string | Nombre comercial |
| `tipo_oferta` | categórico | plan_movil / plan_hogar / upgrade / equipo / paquete_adicional / movistar_total |
| `segmento_objetivo` | categórico | movil / hogar / ambos |
| `es_movistar_total` | bool | Si es una de las 3 variantes de MT |
| `precio_mensual` | float | Precio en soles |
| `ahorro_pct` | int | % ahorro estimado (solo MT). **Ilustrativo — preferir el cálculo propio** |
| `gb_incluidos` | int | GB incluidos. **9999 = ilimitado**, no 9999 GB |
| `cluster_hogar` | categórico | mono / duo / trio. Nulo para no-hogar |
| `descripcion_bundle` | string | Qué incluye. Nulo para no-hogar |
| `descripcion_corta` | string | Texto descriptivo |

Variantes MT: `OF020` Básico S/149.9 · `OF021` Plus S/189.9 · `OF022` Max S/229.9

### `historial_campanias.csv` — 300,112 filas

| Columna | Tipo | Descripción |
|---|---|---|
| `ofrecimiento_id` | string (PK) | Identificador del evento |
| `cliente_id` | string (FK) | A qué cliente |
| `oferta_id` | string (FK) | Qué oferta |
| `fecha` | fecha | Fecha del ofrecimiento |
| `canal` | categórico | Tienda / Call In / Call Out / Digital |
| `resultado` | categórico | aceptada / rechazada / **pendiente** |
| `motivo_rechazo` | categórico | Solo si rechazada. 6 valores |
| `es_rebate` | bool | Si hubo contraoferta tras un rechazo |
| `contactabilidad` | categórico | contactado / no_contactado |
| `medio_probatorio` | categórico | registro_plataforma / audio_llamada / chat_log |
| `tipo_cliente`, `antiguedad_meses`, `elegible_mt`, `es_movistar_total` | — | Copiados de clientes |
| `nombre_oferta`, `tipo_oferta` | — | Copiados del catálogo |
| `oferta_es_mt` | bool | Si la **oferta presentada** es MT |

### Trampas — leer con atención

1. **`es_movistar_total` ≠ `oferta_es_mt`.** El primero es del **cliente** (ya tenía MT antes del ofrecimiento); el segundo es de la **oferta presentada**. El diccionario lo marca como el error más fácil de cometer.
2. **`tiene_hogar` ≠ `tiene_internet_hogar`.** Solo TV no habilita MT.
3. **`tipo_cliente` nulo** = cliente sin línea móvil. Nulo legítimo, no faltante.
4. **`gb_incluidos = 9999`** significa ilimitado. Tratarlo como numérico crudo distorsiona el modelo.
5. **`monto_facturado_prom` ≠ `monto_facturado_prom_6m`.** El primero es del plan actual, el segundo es histórico.

## 5. Reglas de modelado — no negociables

### Modelo A: aceptación

```
Universo:  historial WHERE contactabilidad = 'contactado'
Target:    y = 1 si resultado = 'aceptada'
           y = 0 si resultado = 'rechazada'
           descartar 'pendiente'
```

### Modelo B: contactabilidad

```
Universo:  historial completo
Target:    y = 1 si contactabilidad = 'contactado'
           y = 0 si 'no_contactado'
Features:  canal, mes, perfil del cliente (edad, es_usuario_app, canal_mas_usado,
           n_actividad_canal). NO features de la oferta.
```

### Columnas prohibidas como features en el Modelo A (leakage)

Se conocen **después** del resultado:

- `motivo_rechazo` — solo existe si rechazó
- `es_rebate` — solo ocurre tras un rechazo
- `contactabilidad` — es el target del Modelo B
- `medio_probatorio` — se registra al cerrar el evento
- `resultado` — obvio

**Verificar explícitamente que ninguna está en `X` antes de entrenar. Si el AUC de test supera 0.90, asumir leakage y auditar antes de continuar.**

> Importante: `medio_probatorio` y `contactabilidad` están prohibidas como *features*, pero son el **corazón del módulo de trazabilidad E2E** (sección 6.4). Son dos usos distintos de la misma columna — no las descartes del proyecto, solo del entrenamiento.

### Split temporal, no aleatorio

```
train: fecha <= 2026-04-30
test:  fecha >= 2026-05-01
```

Un split aleatorio pone al mismo cliente en ambos lados e infla las métricas.

### Feature engineering — explícitamente puntuado

Además de las columnas crudas, construir al menos:

- `gasto_actual_total` = precio(`plan_actual_id`) + precio(`oferta_hogar_id`)
- `ahorro_soles_mt` = `gasto_actual_total` − precio del tier MT evaluado
- `ratio_precio_oferta_facturacion` = `precio_mensual` / `monto_facturado_prom`
- `es_upgrade` = si la oferta es de mayor tier que el plan actual
- `gap_a_mt` = qué le falta al cliente para ser elegible: `ninguno` / `producto_hogar` / `internet_hogar` / `migracion_postpago` / `no_alcanzable`
- `presion_datos` = `consumo_datos_gb_prom` / `gb_incluidos` del plan actual (detecta a quien se le queda corto el plan)
- `salud_cliente` = compuesto de `meses_moroso`, `dias_mora_prom`, `n_reclamos`
- `mes` de la fecha del ofrecimiento

### Segmentación

Hacer **ambas cosas**, la ficha pide clustering explícitamente:

1. **K-means** (sklearn) sobre variables de comportamiento: consumo, facturación, mora, actividad de canal, uso de app. Probar k entre 5 y 8, elegir por silhouette.
2. **Capa de reglas** encima que le pone nombre interpretable y descripción a cada cluster ("Convergente Dormido", "Cauteloso por Precio", "MT en Riesgo"). El cluster da el segmento; la regla lo explica.

### Matriz de rebate

Calcular empíricamente sobre el historial: por cada `motivo_rechazo`, qué acción posterior (`es_rebate = True`) convirtió mejor y con qué `n`. **No inventar tasas.** Celdas con `n < 30` se marcan como confianza baja. Las acciones deben respetar la naturaleza del motivo (sección 3.4).

### Abstención

Si el cliente tiene `meses_moroso >= 3` o `n_reclamos` alto, la recomendación **no es un upsell**: es una alerta de retención / cobranza. Esto responde al dolor declarado "riesgo de ofrecer productos poco adecuados" y debe estar implementado, no solo mencionado.

## 6. Módulos de la aplicación

### 6.1 Ficha del cliente + persona

Perfil resumido, cluster asignado con su nombre interpretable y descripción. Diseñada para lectura en segundos por un asesor bajo presión de tiempo.

### 6.2 Journey / mapa del cliente

Línea de tiempo reconstruida del historial real: qué se le ofreció, cuándo, por qué canal, con qué resultado y motivo de rechazo. Permite al asesor ver de un vistazo "a este cliente ya se le ofreció MT Plus dos veces y rechazó por precio". Se cruza con reclamos y mora para marcar puntos de fricción.

### 6.3 Recomendación NBO

Para cada cliente: top ofertas rankeadas por **valor esperado** (contacto × aceptación), con canal sugerido, momento sugerido, probabilidad, drivers explicativos, ahorro calculado en soles, y ruta a MT si aplica. Debe funcionar para todo el portafolio, no solo MT.

### 6.4 Funnel E2E con trazabilidad

Responde al dolor declarado sin resolver. Traza: clasificación del cliente → medio de contacto → mensaje → contactabilidad real → medio probatorio → resultado de venta. Vista agregada (dónde se cae el funnel, por canal) y vista por cliente.

### 6.5 Copiloto conversacional — **la pieza estrella**

El asesor conversa en lenguaje natural. Debe manejar con soltura:

- "¿Qué le ofrezco a este cliente y por qué?"
- "¿Y si le ofrezco el tier Básico en vez del Plus?"
- "Dice que está caro, ¿qué le respondo?"
- "Dame el speech para abrir la llamada"
- "¿Por qué no le recomiendas MT Max?"

Tools disponibles: `get_cliente`, `get_journey`, `get_nbo`, `sugerir_rebate`, `calcular_ahorro`, `get_ruta_mt`.

Requisitos de calidad de esta pieza (es donde más esfuerzo de pulido va):
- **Streaming** de la respuesta, no esperar al final
- Los tool calls deben ser visibles en la UI mientras ocurren (transmite que está consultando datos, no inventando)
- Tono adecuado para un asesor en llamada: directo, sin relleno, en español peruano neutro
- Nunca una cifra sin respaldo de tool

## 7. Stack e infraestructura

### Todo local, todo en Docker

Desarrollo completo con `docker compose`: base de datos, backend, frontend y job de entrenamiento, cada uno en su contenedor. El objetivo es que subirlo después a nuestro VPS (corre **Dokploy**) sea trivial. Nada de servicios cloud gestionados ni dependencias que solo existan en una máquina.

### Dependencias: `mise`

Usamos [`mise`](https://mise.jdx.dev/) para versiones de runtimes. Definir `mise.toml` en la raíz con versiones de Python y Node. Las dependencias de cada servicio van en su propio manifiesto dentro de su contenedor.

### Entrenamiento en local

En la máquina, no en la nube. 300k filas con LightGBM entrena en menos de un minuto. Un solo comando, artefactos a un volumen compartido.

### La capa de IA debe ser intercambiable

Vamos a usar modelos gratuitos (probablemente **Gemini** por su tier gratuito), pero **el proveedor debe ser reemplazable**. Cambiar a Claude o a OpenAI no puede requerir tocar lógica de aplicación: solo una variable de entorno.

Sugerencia a evaluar: el **Vercel AI SDK** (`ai` + `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) abstrae proveedores y da tool calling y streaming uniformes. Aislar toda interacción con el LLM en un único módulo (`ai/provider.ts`); nada fuera de ahí importa el SDK de un proveedor.

### Decisiones delegadas al agente

El resto del stack lo decides tú, con criterio de **velocidad de iteración y simplicidad**, no de arquitectura ideal. Restricciones:

- **Postgres** como base de datos
- Backend con API HTTP y loop de tool calling **del lado del servidor** (la API key nunca llega al navegador)
- Frontend React
- Pipeline de datos en Python: pandas, LightGBM, scikit-learn, pyarrow

**No instalar `shap`.** LightGBM da contribuciones por feature nativamente con `model.predict(X, pred_contrib=True)`. Eso alimenta los drivers de la UI sin dependencia extra.

**Nada de** MLflow, Optuna, Airflow, Kubernetes ni herramientas de MLOps. Es una demo de 15 horas.

## 8. Contrato de datos

**Primera tarea y bloquea todo lo demás.** Antes de escribir otro código, fijar el esquema JSON que cruza entre pipeline, backend y frontend. Una vez fijado, los tres avanzan en paralelo.

Estructura mínima (refinable, pero debe quedar escrita en el repo antes de continuar):

```jsonc
// GET /clientes/:id
{
  "cliente_id": "CLI000131",
  "tipo_cliente": "postpago",
  "antiguedad_meses": 102,
  "monto_facturado_prom": 214.08,
  "gasto_actual_total": 214.08,
  "consumo_datos_gb_prom": 41.79,
  "edad_rango": "18-25",
  "departamento": "Lima",
  "canal_mas_usado": "Digital",
  "meses_moroso": 0,
  "n_reclamos": 0,
  "elegible_mt": true,
  "es_movistar_total": false,
  "gap_a_mt": "ninguno",
  "persona": { "cluster_id": 3, "nombre": "Convergente Dormido", "descripcion": "..." },
  "alerta_retencion": false,
  "motivo_alerta": null
}

// GET /clientes/:id/nbo
{
  "cliente_id": "CLI000131",
  "abstenerse": false,
  "motivo_abstencion": null,
  "recomendaciones": [
    {
      "oferta_id": "OF021",
      "nombre_oferta": "Movistar Total Plus",
      "tipo_oferta": "movistar_total",
      "precio_mensual": 189.9,
      "es_movistar_total": true,
      "rank": 1,
      "canal_sugerido": "Digital",
      "momento_sugerido": "Martes a jueves, 10:00-13:00",
      "prob_contacto": 0.82,
      "prob_aceptacion": 0.71,
      "valor_esperado": 0.58,
      "ahorro_soles": 24.18,
      "drivers": [
        { "feature": "gasto_actual_total", "valor": 214.08, "contribucion": 0.18,
          "texto": "Ya paga S/ 214 al mes por separado" }
      ]
    }
  ],
  "ruta_mt": null
}

// Cliente NO elegible: ruta_mt se llena
"ruta_mt": {
  "gap": "internet_hogar",
  "descripcion": "Tiene móvil postpago y TV, le falta internet hogar",
  "paso_1": { "oferta_id": "OF005", "nombre_oferta": "Internet Hogar 100Mb", "prob_aceptacion": 0.44 },
  "paso_2": { "oferta_id": "OF020", "nombre_oferta": "Movistar Total Basico" }
}

// GET /clientes/:id/journey
{
  "cliente_id": "CLI000131",
  "eventos": [
    { "fecha": "2026-01-10", "oferta_id": "OF002", "nombre_oferta": "Plan Movil Plus 25GB",
      "canal": "Digital", "resultado": "aceptada", "motivo_rechazo": null,
      "oferta_es_mt": false, "contactabilidad": "contactado",
      "medio_probatorio": "registro_plataforma" }
  ],
  "fricciones": [ { "tipo": "reclamo", "n": 0 }, { "tipo": "mora", "meses": 0 } ]
}

// GET /rebate?motivo=precio
{
  "motivo": "precio",
  "naturaleza": "precio",
  "tasa_base": 0.12,
  "acciones": [
    { "accion": "bajar_tier", "descripcion": "Ofrecer el tier inmediatamente inferior",
      "tasa_conversion": 0.34, "n": 412, "confianza": "alta" }
  ]
}

// GET /funnel?canal=Digital
{
  "canal": "Digital",
  "etapas": [
    { "etapa": "ofrecimientos", "n": 74210 },
    { "etapa": "contactados", "n": 61840 },
    { "etapa": "aceptados", "n": 19230 }
  ],
  "medios_probatorios": { "registro_plataforma": 41200, "audio_llamada": 18300, "chat_log": 14710 }
}

// GET /metrics
{
  "modelo_aceptacion": { "auc_test": 0.74, "n_train": 180000, "n_test": 62000 },
  "modelo_contactabilidad": { "auc_test": 0.68 },
  "lift_decil_superior": 2.8,
  "tasa_base_aceptacion": 0.31,
  "cobertura_perdida_mt": { "clientes_elegibles": 18420, "nunca_ofertados_mt": 11003, "pct": 0.597 },
  "participacion_mt": {
    "venta_hogar_actual_pct": 0.21, "meta_pct": 0.50,
    "venta_movil_actual_pct": 0.04, "meta_movil_pct": 0.10,
    "proyectada_hogar_pct": 0.38, "proyectada_movil_pct": 0.09
  },
  "mercado_ampliado_mt": { "ya_elegibles": 18420, "a_un_producto": 34100 }
}

// POST /copiloto/chat  → streaming SSE
```

## 9. Artefactos del pipeline

| Archivo | Contenido |
|---|---|
| `nbo_scores.parquet` | `cliente_id, oferta_id, canal, prob_contacto, prob_aceptacion, valor_esperado, rank, ahorro_soles, drivers` |
| `personas.parquet` | `cliente_id, cluster_id, persona, persona_desc, alerta_retencion` |
| `ruta_mt.parquet` | `cliente_id, gap_a_mt, oferta_puente_id, prob_puente` |
| `rebate_matrix.json` | `motivo → [{accion, n, tasa_conversion, confianza}]` |
| `funnel.json` | Agregados por canal y etapa |
| `metrics.json` | Métricas de impacto y de modelo |
| `model_card.md` | AUC, lift por decil, tamaños, features usadas, decisiones de marcado |

El backend los carga a Postgres en un seed idempotente.

## 10. Orden de trabajo

1. **Contrato de datos** escrito y commiteado. Nada arranca antes.
2. **`docker compose up` end-to-end con servicios vacíos**: Postgres levanta, backend responde `{"ok": true}`, frontend carga. Verificar esto temprano, cuando todavía no hay nada que arreglar.
3. **Schema, migraciones, seed** de `clientes` y `ofertas` desde CSV.
4. **Endpoints con fixtures** que cumplen el contrato. Desbloquea al frontend sin esperar al modelo.
5. **Pipeline**: EDA breve, feature engineering, dos modelos, clustering, matriz de rebate, scoring masivo, artefactos.
6. **Seed real** reemplazando fixtures.
7. **Copiloto** con tool calling y streaming. **Aquí va el tiempo extra de pulido.**
8. **Frontend** contra datos reales.

## 11. Qué NO hacer

- No usar `motivo_rechazo`, `es_rebate`, `contactabilidad` ni `medio_probatorio` como features del modelo de aceptación
- No hacer split aleatorio
- No tratar `pendiente` como rechazo (pero tampoco descartarlo del proyecto: es el Modelo B)
- No dejar que el LLM decida ofertas, calcule probabilidades o invente cifras
- No poner la API key del LLM en el frontend
- No importar el SDK de un proveedor de IA fuera del módulo de abstracción
- No instalar `shap`, MLflow, Optuna ni MLOps
- No usar factorización matricial ni embeddings para 22 ofertas
- No optimizar hiperparámetros: los defaults de LightGBM bastan
- No construir solo para MT: el motor debe ser generalizable al portafolio

---

## Primera tarea

1. Inspeccionar los CSV y confirmar que las columnas coinciden con este documento. Reportar discrepancias.
2. Proponer el stack concreto (frameworks y versiones) con una línea de justificación por decisión.
3. Escribir el **contrato de datos** definitivo en el repo.
4. Armar `docker-compose.yml` y `mise.toml`.

**Detenerse ahí y reportar antes de escribir lógica de negocio.**
