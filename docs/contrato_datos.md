# Contrato de datos — Copiloto NBO

**Estado: CONGELADO.** Este documento es la fuente de verdad entre `pipeline`, `web` (API) y el futuro frontend. Cambiarlo requiere actualizar los tres lados a la vez.

Base URL: `/api` · Content-Type: `application/json; charset=utf-8`

## Convenciones

- Todo importe monetario en **soles peruanos**, `number` con 2 decimales.
- Toda probabilidad en `[0,1]`, `number` con 4 decimales.
- Fechas en ISO `YYYY-MM-DD`. El dataset cubre **2026-01-01 → 2026-06-30**.
- `null` es un valor legítimo y significa "no aplica" (ej. `tipo_cliente` nulo = cliente sin línea móvil). Nunca se sustituye por `""` ni `0`.
- Canales: `Tienda` · `Call In` · `Call Out` · `Digital`.
- **Ninguna cifra de esta API es inventada por un LLM.** Todo sale del pipeline o de Postgres.

## Errores

```jsonc
// 404 — cliente inexistente
{ "error": "cliente_no_encontrado", "detalle": "CLI999999 no existe" }
// 400 — parámetro inválido
{ "error": "parametro_invalido", "detalle": "motivo debe ser uno de: precio, ya_tiene_similar, ..." }
// 503 — artefactos del pipeline aún no cargados
{ "error": "artefactos_no_disponibles", "detalle": "Ejecutar el pipeline y el seed" }
```

---

## `GET /api/health`

```jsonc
{
  "ok": true,
  "db": "up",
  "artefactos": { "cargados": true, "generado_en": "2026-08-15T14:02:11Z" },
  "modo_datos": "real"   // "fixtures" | "real"
}
```

## `GET /api/clientes/:id`

Ficha del cliente. Diseñada para lectura en segundos por un asesor.

```jsonc
{
  "cliente_id": "CLI000131",
  "tipo_cliente": "postpago",          // "prepago" | "postpago" | null (sin línea móvil)
  "antiguedad_meses": 102,
  "tiene_movil": true,
  "tiene_hogar": true,
  "tiene_internet_hogar": true,        // OJO: distinto de tiene_hogar (solo TV no habilita MT)
  "es_movistar_total": false,          // el CLIENTE ya tiene MT
  "elegible_mt": true,
  "plan_actual_id": "OF002",
  "plan_actual_nombre": "Plan Movil Plus 25GB",
  "oferta_hogar_id": "OF008",
  "oferta_hogar_nombre": "Internet Hogar 100Mb",
  "monto_facturado_prom": 214.08,
  "monto_facturado_prom_6m": 209.44,
  "gasto_actual_total": 214.08,        // DERIVADA: precio(plan_actual) + precio(oferta_hogar)
  "edad_rango": "18-25",
  "departamento": "Lima",
  "es_usuario_app": true,
  "consumo_datos_gb_prom": 41.79,
  "consumo_voz_min_prom": 200.0,
  "consumo_sms_prom": 8.17,
  "uso_app_movistar_prom": 3.33,
  "canal_mas_usado": "Digital",        // null si no hubo interacciones
  "n_actividad_canal": 7,
  "dias_mora_prom": 0.0,
  "meses_moroso": 0,
  "n_reclamos": 0,

  // DERIVADAS del pipeline
  "gap_a_mt": "ninguno",               // ninguno | producto_hogar | internet_hogar | migracion_postpago | no_alcanzable | ya_es_mt
  "presion_datos": 1.67,               // consumo_datos_gb_prom / gb_incluidos(plan_actual); null si ilimitado
  "salud_cliente": "buena",            // buena | observada | critica
  "persona": {
    "cluster_id": 3,
    "nombre": "Convergente Dormido",
    "descripcion": "Tiene móvil y hogar por separado, consumo alto y sin mora. No se le ha ofrecido convergencia."
  },
  "alerta_retencion": false,
  "motivo_alerta": null                // texto si alerta_retencion = true
}
```

## `GET /api/clientes/:id/nbo`

Next Best Offer. Ranking sobre las ofertas elegibles del catálogo (**las 22, no solo MT**).

`valor_esperado = prob_contacto × prob_aceptacion`. El ranking es por `valor_esperado`, no por probabilidad de aceptación sola: de nada sirve una oferta que el cliente aceptaría si no se le puede contactar.

**Política de ranking (blindaje).** El modelo no distingue entre ofertas no-MT:
los empates de valor esperado son la norma, y con AUC 0.587 las diferencias
menores a 0.01 están por debajo de su resolución. Dentro de ese empate técnico
decide una política de negocio declarada, en este orden: (1) `avanza_a_mt` —
la oferta es MT o es el puente que cierra el gap del cliente; (2) nunca un
downgrade de plan como jugada proactiva (baja ARPU); (3) valor esperado exacto,
ahorro, precio. El campo `avanza_a_mt` viene en cada recomendación para que la
UI pueda mostrar de dónde sale el orden. La política solo rompe empates: si el
modelo ve una diferencia real (≥ 0.01 de VE), el modelo gana.

Query params opcionales: `?canal=Digital` (fuerza el canal, para el escenario "el cliente ya está en la tienda"), `?limit=5`.

```jsonc
{
  "cliente_id": "CLI000131",
  "abstenerse": false,
  "motivo_abstencion": null,           // si abstenerse=true, recomendaciones va vacío y esto explica por qué
  "generado_en": "2026-08-15T14:02:11Z",
  "recomendaciones": [
    {
      "rank": 1,
      "oferta_id": "OF021",
      "nombre_oferta": "Movistar Total Plus",
      "tipo_oferta": "movistar_total",
      "descripcion_corta": "Movistar Total Plus - 60GB - S/ 189.9",
      "precio_mensual": 189.9,
      "es_movistar_total": true,       // la OFERTA es MT (≠ cliente.es_movistar_total)
      "gb_incluidos": 60,
      "gb_ilimitado": false,           // true cuando el catálogo trae 9999

      "canal_sugerido": "Digital",
      // De dónde sale el canal. En este dataset la contactabilidad no es
      // predecible (AUC 0.500) y la aceptación no varía por canal, así que
      // NO se presenta como salida del modelo:
      //   "preferencia_observada"   -> de canal_mas_usado del cliente (regla)
      //   "modelo_valor_esperado"   -> argmax, solo si el cliente no tiene
      //                                canal preferido registrado
      //   "forzado_por_asesor"      -> se pasó ?canal= en la request
      "canal_origen": "preferencia_observada",

      // Normalmente null: el historial tiene 6 fechas en total (el día 10 de
      // cada mes), así que no hay resolución para recomendar día ni franja.
      // Solo se llena cuando hay una señal real: un rechazo previo por
      // mal_momento. `momento_origen` es null o "rechazo_previo_mal_momento".
      "momento_sugerido": null,
      "momento_origen": null,

      "prob_contacto": 0.8213,
      "prob_aceptacion": 0.7104,
      "valor_esperado": 0.5834,

      "ahorro_soles": 24.18,           // gasto_actual_total − precio_mensual. null si no aplica
      "ahorro_pct_real": 0.113,        // calculado, NO el ahorro_pct ilustrativo del catálogo
      "avanza_a_mt": true,             // la oferta es MT o es el puente del gap de este cliente

      // Top contribuciones de LightGBM (pred_contrib), ya traducidas a
      // lenguaje de asesor. `a_favor` es el signo de la contribución: la UI
      // separa los argumentos de las objeciones, porque listar un factor
      // negativo bajo "por qué esta oferta" haría que el asesor lo use como
      // argumento de venta.
      "drivers": [
        { "feature": "gasto_actual_total", "valor": 214.08, "contribucion": 0.18,
          "a_favor": true, "texto": "Hoy paga S/ 214.08 al mes sumando todos sus servicios" },
        { "feature": "oferta_es_mt", "valor": false, "contribucion": -0.09,
          "a_favor": false, "texto": "No es una oferta Movistar Total, que es lo que mejor convierte" }
      ],

      "por_canal": [                   // el mismo cálculo en los 4 canales, para el simulador
        { "canal": "Digital",  "prob_contacto": 0.8213, "prob_aceptacion": 0.7104, "valor_esperado": 0.5834 },
        { "canal": "Tienda",   "prob_contacto": 0.7401, "prob_aceptacion": 0.6902, "valor_esperado": 0.5108 }
      ]
    }
  ],
  "ruta_mt": null                      // ver abajo
}
```

**Cliente NO elegible a MT** → `ruta_mt` se llena con el camino de dos pasos:

```jsonc
"ruta_mt": {
  "gap": "internet_hogar",
  "descripcion": "Tiene móvil postpago y TV, le falta internet hogar para ser elegible a Movistar Total",
  "paso_1": { "oferta_id": "OF005", "nombre_oferta": "Internet Hogar 100Mb",
              "precio_mensual": 89.9, "prob_aceptacion": 0.4412 },
  "paso_2": { "oferta_id": "OF020", "nombre_oferta": "Movistar Total Basico",
              "precio_mensual": 149.9, "ahorro_soles_proyectado": 18.40 }
}
```

**Cliente con abstención** (mora o reclamos altos): `abstenerse: true`, `recomendaciones: []`, y

```jsonc
"motivo_abstencion": "4 de 6 meses con mora mayor a 15 días. Corresponde gestión de cobranza, no venta."
```

## `GET /api/prioridades?foco=mt&canal=Call Out&solo_nunca_ofertados=true&limit=25`

La parte **proactiva** del motor: a quién contactar primero. Es el
"identificar al cliente potencial" de la ficha, operacionalizado para Call Out
y campañas.

- `foco=mt` (default): la mejor oportunidad de blindaje de cada cliente —
  oferta MT directa o el puente que cierra su gap. `foco=todos`: la
  recomendación #1 sin filtro.
- `solo_nunca_ofertados=true`: solo clientes que jamás recibieron una oferta
  MT — ataca directamente la **cobertura perdida** (12.6% de los elegibles).
- Los clientes en abstención **no aparecen**: llamarlos para vender es el
  error que el motor existe para evitar.
- `limit` máximo 200 (default 25). `offset` entero ≥ 0 (default 0) para paginar.
- `total` es cuántos clientes hay en la cola con esos filtros; `n` es cuántos
  trae esta página. Sin `total` no hay forma de saber que detrás de las 50 filas
  de pantalla hay 57 mil clientes, y una cola sin contexto se lee como un
  dataset recortado.
- El orden es **total y determinístico**: termina desempatando por `cliente_id`.
  Sin ese último criterio hay grupos de ~12 clientes con las tres claves
  anteriores idénticas y SQL no garantiza en qué orden los devuelve — paginar
  sobre un orden inestable repite o se salta clientes.

```jsonc
{
  "foco": "mt", "canal": null, "solo_nunca_ofertados": true,
  "total": 57164, "limit": 50, "offset": 0, "n": 50,
  "clientes": [
    {
      "cliente_id": "CLI038262",
      "persona": "Convergente Dormido",
      "gap_a_mt": "ninguno",
      "oferta_id": "OF020", "nombre_oferta": "Movistar Total Basico",
      "es_movistar_total": true, "avanza_a_mt": true,
      "rank": 1, "valor_esperado": 0.6179, "prob_aceptacion": 0.7271,
      "ahorro_soles": 109.90, "canal_sugerido": "Digital",
      "nunca_ofrecido_mt": true,
      "tiene_ruta_mt": false, "ahorro_soles_proyectado": null
    }
  ]
}
```

## `GET /api/segmento?edad_rango=26-35&departamento=Ica&elegible_mt=true`

Estadísticas de un **grupo** de clientes. El resto del contrato mira un cliente
a la vez, que es lo correcto para armar un argumento; esto responde la otra
mitad de la pregunta del asesor: *"¿y los clientes como este?"*.

Filtros, todos opcionales y combinables: `edad_rango`, `departamento`,
`tipo_cliente`, `cluster_id`, `gap_a_mt`, `salud_cliente`, `canal_mas_usado`,
`elegible_mt`, `es_movistar_total`, `es_usuario_app`. **Sin filtros devuelve la
planta entera** (100 000 clientes). Un valor fuera de su lista da `400`: un
filtro con errata devolvería un segmento vacío que parece un hallazgo.

- Todo conteo viene con su porcentaje. Devolver los dos juntos es lo que evita
  que el copiloto tenga que dividir — y una división suya es una cifra sin
  respaldo.
- `conversion_historica` está **medida** sobre los ofrecimientos reales del
  historial. `oportunidad` es una **proyección** del modelo: qué recomendaría
  hoy. La `nota_metodologica` viaja en la respuesta para que no se confundan.
- `confianza: "baja"` con menos de 100 clientes: promedios de un grupo chico
  son anécdota.
- Una tasa sobre cero ofrecimientos es `null`, no `0`: "nunca se midió" no es
  "convierte 0%".
- Cohorte vacía → `n_clientes: 0` y una `nota`, sin bloques que promediar.

```jsonc
{
  "filtros_aplicados": { "edad_rango": "26-35" },
  "n_clientes": 28045, "pct_de_la_base": 0.2804, "confianza": "alta",
  "perfil": {
    "antiguedad_meses_prom": 90.4, "gasto_actual_total_prom": 122.57,
    "consumo_datos_gb_prom": 29.93, "dias_mora_prom": 7.98,
    "n_postpago": 15811, "n_prepago": 10441, "n_sin_movil": 1793,
    "n_usuarios_app": 21048, "pct_usuarios_app": 0.7505
  },
  "movistar_total": {
    "n_elegibles": 3896, "pct_elegibles": 0.1389,
    "n_ya_mt": 1984, "pct_ya_mt": 0.0707,
    // Cobertura perdida del segmento: elegibles a los que nunca se les
    // presentó MT. Es la oportunidad accionable, no un dato descriptivo.
    "n_elegibles_nunca_ofertados": 498,
    "desglose_gap": [{ "gap": "producto_hogar", "n": 9273, "pct": 0.3306 }]
  },
  "salud": {
    "n_buena": 7954, "n_observada": 16569, "n_critica": 3522,
    "n_abstencion": 3522, "pct_abstencion": 0.1256
  },
  "personas": [
    { "cluster_id": 2, "persona": "Veterano Estable", "n": 7671, "pct": 0.2735 }
  ],
  "oportunidad": [                       // proyección del modelo
    {
      "oferta_id": "OF020", "nombre_oferta": "Movistar Total Basico",
      "es_movistar_total": true, "n_clientes": 3896, "pct": 0.1389,
      "valor_esperado_prom": 0.4203, "ahorro_soles_prom": 35.05
    }
  ],
  "conversion_historica": {              // medida sobre el historial
    "n_ofrecimientos": 84097, "n_aceptadas": 26902, "tasa": 0.3199,
    "n_ofrecimientos_mt": 8122, "n_aceptadas_mt": 4818, "tasa_mt": 0.5932
  },
  "nota_metodologica": "..."
}
```

## `GET /api/clientes/:id/journey`

Línea de tiempo reconstruida del historial real, cruzada con fricciones.

```jsonc
{
  "cliente_id": "CLI000131",
  "resumen": {
    "n_ofrecimientos": 6, "n_aceptados": 1, "n_rechazados": 3, "n_no_contactado": 2,
    "veces_ofrecido_mt": 2, "nunca_ofrecido_mt": false,
    "motivo_rechazo_dominante": "precio"
  },
  "eventos": [
    { "ofrecimiento_id": "OFR0000123", "fecha": "2026-01-10",
      "oferta_id": "OF002", "nombre_oferta": "Plan Movil Plus 25GB", "tipo_oferta": "plan_movil",
      "oferta_es_mt": false, "canal": "Digital",
      "contactabilidad": "contactado",           // contactado | no_contactado
      "resultado": "aceptada",                   // aceptada | rechazada | pendiente
      "motivo_rechazo": null,
      "es_rebate": false,
      "medio_probatorio": "registro_plataforma"  // registro_plataforma | audio_llamada | chat_log
    }
  ],
  "fricciones": [
    { "tipo": "reclamo", "n": 0 },
    { "tipo": "mora", "meses": 0, "dias_prom": 0.0 }
  ]
}
```

## `GET /api/rebate?motivo=precio`

Matriz de rebate **empírica**. No hay tasas inventadas: cada celda trae su `n`.

> **Nota metodológica — no se usa `es_rebate`.** En este dataset `es_rebate = true`
> marca 47,572 filas y **todas** son `rechazada`: su tasa de aceptación es
> exactamente 0.0000, y la bandera se reparte al azar sobre ~30% de los rechazos.
> Calcular la matriz sobre esa columna daría 0% en las 36 celdas. Se mide en su
> lugar la **recuperación secuencial**: tras un rechazo, ¿aceptó el cliente el
> siguiente ofrecimiento, y qué acción se tomó entre ambos? Detalle en
> [hallazgos_datos.md](hallazgos_datos.md).

```jsonc
{
  "motivo": "precio",
  "naturaleza": "precio",              // precio | informacion | encaje | confianza | timing | ninguna
  "explicacion_naturaleza": "Único motivo donde mover precio o bajar de tier tiene sentido.",
  "tasa_base": 0.307,                  // recuperación tras este motivo, sin distinguir acción
  "n_total": 38082,
  "acciones": [                        // SOLO las coherentes con la naturaleza, mejor primero
    { "accion": "pivot_a_mt", "descripcion": "Pivotar a Movistar Total",
      "tasa_conversion": 0.584, "n": 1135, "confianza": "alta",
      "dias_mediana_hasta_siguiente": 31, "coherente_con_naturaleza": true }
  ],
  "acciones_descartadas": [            // visibles para auditoría, no para recomendar
    { "accion": "subir_valor", "tasa_conversion": 0.298, "n": 16590,
      "coherente_con_naturaleza": false,
      "razon_descarte": "incoherente con la naturaleza del motivo" }
  ]
}
```

`confianza` es `"alta"` si `n >= 30`, `"baja"` si no.

La separación entre `acciones` y `acciones_descartadas` es deliberada: la tasa
sale de los datos, pero **qué palanca corresponde a cada motivo es criterio de
negocio**. Un rechazo por `no_confia` no se responde con un descuento aunque el
número lo permitiera. Las descartadas quedan expuestas para que la decisión sea
auditable, no oculta.

Sin `?motivo` devuelve `{ "metodo", "nota_metodologica", "motivos": [ ...6... ] }`.

## `GET /api/funnel?canal=Digital`

Trazabilidad E2E. Responde al dolor declarado: *"no existen reportes unificados ni plataformas automáticas de escucha que permitan identificar si un producto fue efectivamente ofrecido"*.

Sin `?canal` devuelve el consolidado con desglose por canal.

```jsonc
{
  "canal": "Digital",                  // null = todos
  "etapas": [
    { "etapa": "ofrecimientos", "n": 104598, "pct_del_anterior": null },
    { "etapa": "contactados",   "n": 88721,  "pct_del_anterior": 0.848 },
    { "etapa": "con_medio_probatorio", "n": 88721, "pct_del_anterior": 1.0 },
    { "etapa": "aceptados",     "n": 33104,  "pct_del_anterior": 0.373 }
  ],
  "medios_probatorios": { "registro_plataforma": 41200, "audio_llamada": 18300, "chat_log": 29221 },
  "rechazos_por_motivo": { "precio": 19204, "no_necesita": 11021, "ya_tiene_similar": 8300,
                           "mal_momento": 8112, "no_confia": 5510, "otro": 2470 },
  "mt": { "ofrecimientos_mt": 12040, "aceptados_mt": 4102, "pct_venta_con_mt": 0.124 },
  "por_canal": [ { "canal": "Tienda", "etapas": [ ... ] } ]   // solo cuando no se filtra
}
```

## `GET /api/metrics`

Métricas de modelo y de impacto de negocio. Alimenta el pitch.

```jsonc
{
  "generado_en": "2026-08-15T14:02:11Z",
  "modelo_aceptacion": {
    "auc_test": 0.5874, "auc_train": 0.5998,
    // Piso de comparación: una regla de UNA variable ("¿la oferta es MT?").
    // El margen entre ambos es todo lo que aportan las otras 39 features.
    "auc_baseline_solo_mt": 0.5635, "aporte_sobre_baseline": 0.0239,
    "brier_test": 0.2273,            // calibración: la probabilidad se le muestra al asesor
    "n_train": 127020, "n_valid": 42600, "n_test": 84998,
    "tasa_base_train": 0.3747,
    "lift_decil_superior": 1.79,
    "lift_por_decil": [1.79, 1.0, 1.0, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95],
    "n_arboles": 9, "n_features": 40,
    "split": { "train_hasta": "2026-03-31", "valid": "2026-04", "test_desde": "2026-05-01" }
  },
  "modelo_contactabilidad": {
    "auc_test": 0.4998,
    "predecible": false,             // se reporta, no se disimula
    "nota": "Contactabilidad no es predecible en este dataset: la tasa es constante (~0.848) en todo canal, mes y perfil. El modelo queda en el pipeline porque es la arquitectura correcta para datos reales, pero NO se presenta como recomendador de canal."
  },
  "importancia_aceptacion": [ { "feature": "oferta_es_mt", "gain": 12345.6 } ],
  "cobertura_perdida_mt": { "clientes_elegibles": 13650, "nunca_ofertados_mt": 1716, "pct": 0.1257 },
  "participacion_mt": {
    "definicion": "Venta hogar = aceptadas de tipo plan_hogar más las de MT. Venta móvil = plan_movil más MT. MT cuenta en ambas por ser convergente.",
    "venta_hogar_actual_pct": 0.36, "meta_hogar_pct": 0.50,
    "venta_movil_actual_pct": 0.42, "meta_movil_pct": 0.10
  },
  "proyeccion_modelo": {
    // Proyección del modelo, NO un resultado medido. El método va explícito.
    "metodo": "Suma de valor esperado de la recomendación #1 de cada cliente, bajo el supuesto de que se ofrece a toda la planta.",
    "ventas_esperadas_total": 33120.4, "ventas_esperadas_mt": 5988.2,
    "proyectada_hogar_pct": 0.41, "proyectada_movil_pct": 0.33
  },
  "mercado_ampliado_mt": {
    "ya_elegibles": 13650,
    "a_un_producto": 48872,             // gap_a_mt en {producto_hogar, internet_hogar, migracion_postpago}
    "total_alcanzable": 62522,
    "multiplicador_vs_columna_cruda": 4.58,
    "desglose_gap": { "producto_hogar": 32708, "migracion_postpago": 13858,
                      "internet_hogar": 2306, "no_alcanzable": 30284, "ya_es_mt": 7194 }
  },
  "abstenciones": { "clientes_con_alerta": 12531, "pct": 0.1253,
                    "criterio": "meses_moroso >= 3 o n_reclamos >= 4" },
  "segmentacion": { "k": 6, "silhouette_por_k": {}, "clusters": [] }
}
```

## `GET /api/ofertas`

Catálogo completo (22). Necesario para el simulador "¿y si le ofrezco otra?".

```jsonc
{ "ofertas": [ { "oferta_id": "OF020", "nombre_oferta": "Movistar Total Basico",
                 "tipo_oferta": "movistar_total", "segmento_objetivo": "ambos",
                 "es_movistar_total": true, "precio_mensual": 149.9,
                 "gb_incluidos": 30, "gb_ilimitado": false,
                 "cluster_hogar": null, "descripcion_bundle": null,
                 "descripcion_corta": "Movistar Total Basico - 30GB - S/ 149.9" } ] }
```

## `POST /api/copiloto/chat` — streaming SSE

La pieza estrella. **El LLM no decide ofertas ni calcula probabilidades**: llama tools que leen de Postgres y traduce el resultado a lenguaje natural.

Request:

```jsonc
{
  "cliente_id": "CLI000131",                    // contexto de la conversación
  "messages": [ { "role": "user", "content": "¿Qué le ofrezco a este cliente y por qué?" } ]
}
```

Respuesta: `text/event-stream`. Eventos:

```
event: tool-call
data: {"toolCallId":"c1","toolName":"get_nbo","args":{"cliente_id":"CLI000131"}}

event: tool-result
data: {"toolCallId":"c1","toolName":"get_nbo","resumen":"3 recomendaciones, top OF021"}

event: text-delta
data: {"delta":"Ofrécele Movistar Total Plus. "}

event: finish
data: {"finishReason":"stop","toolCalls":2}

event: error
data: {"error":"llm_no_disponible","detalle":"..."}
```

Los eventos `tool-call` / `tool-result` se emiten **mientras ocurren**, para que la UI muestre que el copiloto está consultando datos y no improvisando.

### Tools expuestos al modelo

| Tool | Argumentos | Devuelve |
|---|---|---|
| `get_cliente` | `cliente_id` | La ficha de `GET /clientes/:id` |
| `get_nbo` | `cliente_id`, `canal?`, `limit?` | El ranking de `GET /clientes/:id/nbo` |
| `get_journey` | `cliente_id` | El journey de `GET /clientes/:id/journey` |
| `sugerir_rebate` | `motivo` | La matriz de `GET /rebate?motivo=` |
| `calcular_ahorro` | `cliente_id`, `oferta_id` | `{ gasto_actual_total, precio_oferta, ahorro_soles, ahorro_pct }` |
| `get_ruta_mt` | `cliente_id` | El objeto `ruta_mt` |
| `evaluar_oferta` | `cliente_id`, `oferta_id` | Score de UNA oferta concreta: probs, valor esperado, rank, y por qué no es la #1 |
| `listar_ofertas` | — | El catálogo de `GET /ofertas`, para resolver nombres o IDs |
| `proximos_clientes` | `foco?`, `canal?`, `solo_nunca_ofertados?`, `limit?` | La cola de `GET /prioridades`: a quién llamar ahora |
| `analizar_segmento` | los 10 filtros de `GET /segmento`, todos opcionales | Estadísticas de un GRUPO: rango de edad, departamento, persona, o la planta entera |

`GET /api/copiloto/tools` devuelve esta misma lista con sus esquemas de
argumentos, más `{ proveedor, modelo, configurado }`. Sirve para verificar el
cableado del copiloto sin API key y sin gastar una llamada al LLM.

### Reglas duras del system prompt

1. Ninguna cifra (probabilidad, precio, ahorro, tasa) que no venga de un resultado de tool. Si falta el dato, lo dice.
2. No elige ofertas por su cuenta: la recomendación es la que devuelve `get_nbo`.
3. Si `abstenerse = true`, no arma argumentario de venta: comunica la alerta.
4. Español peruano neutro, directo, sin relleno. El asesor está en llamada.
5. **La lectura es suya; la cifra, no.** La regla 1 prohíbe inventar números, no
   pensar: interpretar lo que el tool devolvió —si el cliente es buen
   candidato, si su segmento está desatendido— es el trabajo. Por eso no
   responde volcando campos, sino con lectura → veredicto → evidencia → acción.
   Y por eso al comparar cliente contra grupo cita las dos cifras tal como
   vinieron en vez de restarlas: una resta suya sería una cifra sin respaldo.
