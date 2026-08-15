# Copiloto NBO

Motor de **Next Best Offer** con Movistar Total como caso de uso prioritario.
Desafío 02 — Personalización comercial inteligente · Hackatón *AI Telecom
Challenge* (Movistar × Universidad de Lima).

Incluye el pipeline de datos, el motor de recomendación, el copiloto
conversacional y el panel del asesor.

## El principio

> **El modelo decide y es auditable. El LLM explica, argumenta y conversa.**

El LLM no elige ofertas ni estima probabilidades: eso lo hace un modelo
supervisado entrenado sobre el historial real. El LLM traduce el output del
motor a lenguaje natural. **Ninguna cifra que el copiloto pronuncie puede venir
de otro lado que no sea un resultado de tool.**

## Arranque

```bash
cp .env.example .env
docker compose up -d db web
```

`http://localhost:3000/api/health` debe responder `{"ok":true}`.

Luego, el pipeline completo (de CSV a Postgres, un solo comando, ~4 min):

```bash
docker compose run --rm pipeline python -m src.run_all
```

Y la verificación del contrato contra datos reales:

```bash
./scripts/verify_contrato.sh
```

Con [`mise`](https://mise.jdx.dev/) instalado hay atajos: `mise run up`,
`mise run pipeline`, `mise run verify`, `mise run psql`.

### Copiloto conversacional

Necesita una API key. El resto de la API funciona sin ella (`/api/copiloto/chat`
devuelve `503 llm_no_disponible`, que es el comportamiento correcto).

```bash
# en .env
AI_PROVIDER=google          # google | anthropic | openai
AI_MODEL=gemini-2.0-flash
GOOGLE_GENERATIVE_AI_API_KEY=...
```

Cambiar de proveedor es cambiar esas variables: ningún archivo fuera de
[`web/src/ai/provider.ts`](web/src/ai/provider.ts) importa un SDK de IA. La key
vive solo en el servidor — el loop de tool calling corre del lado del backend y
el navegador nunca la ve.

Tras editar `.env` hay que **recrear** el contenedor, no reiniciarlo: el entorno
se fija al crearlo.

```bash
docker compose up -d --force-recreate web
```

Para conversar con él desde la terminal, mostrando los tool calls a medida que
ocurren:

```bash
./scripts/probar_copiloto.sh CLI000013 "¿Qué le ofrezco a este cliente y por qué?"
```

```
→ get_cliente({"cliente_id": "CLI000013"})
→ get_nbo({"cliente_id": "CLI000013"})
← get_nbo: 6 recomendaciones, top OF020

Ofrece Movistar Total Básico (OF020).
- Precio: S/ 149.90 al mes.
- Ahorro real: S/ 59.90 mensuales respecto a lo que paga hoy.
- Probabilidad de aceptación: 51%.
```

Los cinco diálogos canónicos del asesor —qué ofrecer y por qué, cambio de tier,
objeción de precio, speech de apertura y cliente en abstención— están
verificados contra `CLI000013` y `CLI000001`.

## La interfaz

No es una app aparte: **simula la herramienta interna que el asesor ya usa**
(DITO / Visor), porque ahí es donde la ficha del desafío sitúa el uso. La
restricción de UX que manda es que el asesor tiene al cliente en la línea:
durante la atención **no se navega**.

**Cola de atención** (`/`) — la bandeja de trabajo. Clientes ordenados por
oportunidad, con su segmento, qué ofrecerles, cuánto ahorran y si nunca
recibieron MT. Filtros por foco y canal, y buscador por ID para cuando el
cliente llega por Call In o tienda.

**Cockpit** (`/clientes/:id`) — una sola pantalla, tres zonas con scroll
propio:

- *Quién es*: el buyer persona del clustering, la ficha, y el dato que cambia
  la conversación — lo que **realmente paga** frente a lo que muestra su
  facturación. Debajo, la línea de tiempo con cada ofrecimiento, su resultado,
  el motivo de rechazo y el medio probatorio.
- *Qué ofrecer*: la recomendación con el ahorro en soles como cifra
  protagonista, los factores a favor y en contra separados, la ruta a MT en dos
  pasos, y **seis botones de objeción** que abren la palanca correcta con su
  tasa medida y su `n` — en llamada no hay tiempo de tipear.
- *El copiloto*: chat siempre visible, con los tool calls renderizados
  mientras ocurren. El asesor ve que las cifras se consultan, no se inventan.

Arriba, un selector de canal ("atendiendo por Tienda / Call In / Call Out /
Digital") que re-rankea contra las probabilidades de ese canal.

Si el cliente está en abstención, el centro de la pantalla **bloquea la venta**
y hasta los atajos del copiloto cambian: la herramienta no ofrece un camino
para vender igual.

**Supervisión** (`/supervision`) — el funnel E2E con sus medios probatorios,
los KPIs de MT contra sus metas, el mercado alcanzable y una tarjeta de
transparencia del modelo. No es para el asesor: es para quien tiene que
responder de dónde salen las probabilidades.

## Qué hay adentro

| Servicio | Qué hace |
|---|---|
| `db` | Postgres 16. Migraciones idempotentes en `db/migrations/` |
| `web` | Next.js 15 + Tailwind v4. UI del asesor, API HTTP y copiloto con tool calling server-side |
| `pipeline` | Python 3.12. pandas, LightGBM, scikit-learn. Corre como job |

El pipeline pre-scorea **cliente × ofertas elegibles × 4 canales** (1.37 M pares)
y lo carga a Postgres. El backend solo lee: preguntarle al copiloto "¿y si le
ofrezco el Básico en vez del Plus?" es un `SELECT`, no una llamada a un modelo.

### Los dos modelos

```
Valor esperado = P(contactar | canal, cliente) × P(aceptar | contactado, oferta, canal)
```

- **Modelo A — aceptación.** Universo: `contactabilidad = 'contactado'`.
  Target: aceptada vs rechazada. Los `pendiente` se descartan: coinciden
  exactamente con `no_contactado` (45,494 = 45,494) y no son rechazos.
- **Modelo B — contactabilidad.** Universo completo. Sin features de oferta.

Split temporal (train < abril, validación en abril, test desde mayo), nunca
aleatorio: cada cliente aparece ~3.2 veces en el historial.

### Lo que encontramos en los datos

Los datos son sintéticos y el generador inyectó esencialmente **una** regla: una
oferta de Movistar Total convierte **0.697 contra 0.341**. La contactabilidad es
una moneda al aire constante (0.848 en todo canal, mes y perfil) y el motivo de
rechazo no predice nada.

Eso cambió tres decisiones de diseño, y las tres están documentadas en
**[docs/hallazgos_datos.md](docs/hallazgos_datos.md)**:

1. **No presentamos el canal como predicción.** El Modelo B da AUC 0.500. Se
   queda en el pipeline porque es la arquitectura correcta para datos reales,
   pero el canal sugerido sale de `canal_mas_usado` y va etiquetado como regla
   en el campo `canal_origen`.
2. **La matriz de rebate no usa `es_rebate`.** Esa columna marca 47,572 filas y
   todas son rechazos: su tasa de aceptación es 0.0000. Se mide en su lugar la
   recuperación secuencial (¿aceptó el siguiente ofrecimiento?).
3. **No inventamos un "mejor momento".** El historial tiene 6 fechas en total
   (el día 10 de cada mes). `momento_sugerido` va nulo salvo cuando hay señal
   real: un rechazo previo por `mal_momento`.

Preferimos una regla honesta a un modelo decorativo. El AUC de test del Modelo A
es **0.5874** contra un baseline de una sola variable de **0.5635**: cerca del
techo que estos datos permiten. Un 0.85 acá sería leakage, y el pipeline aborta
si el AUC supera 0.90.

### Las variables que mueven el caso

- **`gap_a_mt`** — qué producto le falta a cada cliente para ser elegible a MT.
  Amplía el mercado de **13,650 a 62,522 clientes (4.6x)** respecto de lo que
  sugiere la columna `elegible_mt`.
- **`gasto_actual_total`** — `monto_facturado_prom` refleja **solo el plan
  móvil**: para un cliente convergente, lo que realmente paga son ~S/109 más.
  Un asesor que mira la facturación en pantalla subestima el ahorro de MT por
  ese margen. Permite decir *"usted paga S/ 209.80 hoy, con Movistar Total
  pagaría S/ 149.90"* en vez del genérico "hasta 50% de ahorro".
- **`presion_datos`**, **`salud_cliente`**, **`ahorro_soles`**, **`es_upgrade`**.

### Política de ranking: el blindaje decide los empates

El modelo no distingue entre ofertas no-MT (los empates de valor esperado son
la norma en este dataset). Dentro de un empate técnico (< 0.01 de VE, por
debajo de la resolución de un modelo con AUC 0.587) decide una política de
negocio **declarada y visible** en el campo `avanza_a_mt`: primero lo que
acerca al cliente a Movistar Total —la oferta MT o su producto puente—, nunca
un downgrade como jugada proactiva. Resultado: la recomendación #1 avanza el
blindaje para el 91–100% del mercado alcanzable, y cero downgrades en el top.
Si el modelo ve una diferencia real de VE, el modelo gana: la política solo
rompe empates.

### Priorización proactiva

`GET /api/prioridades` responde "¿a quién llamo ahora?": la mejor oportunidad
de blindaje de cada cliente, ordenada por valor esperado, con filtros por canal
y por `solo_nunca_ofertados` (la cobertura perdida: elegibles que jamás
recibieron MT). El copiloto la expone con el tool `proximos_clientes` — un
asesor de Call Out puede pedirle "¿a quién llamo para vender MT?" y recibe la
cola con cifras respaldadas.

### Abstención

Con `meses_moroso >= 3` o `n_reclamos >= 4` (12,531 clientes), la recomendación
no es un upsell: `abstenerse: true`, lista de recomendaciones **vacía** y motivo
explícito. Responde al dolor declarado *"riesgo de ofrecer productos poco
adecuados"*, y está implementado, no solo mencionado.

## Despliegue

El VPS **solo sirve la app**: nada de Python, LightGBM ni pandas allá. Los datos
viajan ya calculados dentro de la imagen de la base.

La base completa pesa 867 MB, pero comprime a **25 MB** en
`deploy/nbo.sql.gz`. Ese archivo se copia a `/docker-entrypoint-initdb.d/` de
la imagen de Postgres, que lo restaura sola en su primer arranque — sin job de
seed ni orquestación. En reposo el stack consume **~185 MB de RAM** (64 MB la
web, 120 MB Postgres).

### Flujo

1. Un push a `main` dispara
   [publicar-imagenes.yml](.github/workflows/publicar-imagenes.yml), que
   construye y publica en GHCR `copiloto-nbo-web` (318 MB) y
   `copiloto-nbo-db` (471 MB).
2. En Dokploy, una aplicación de tipo **Docker Compose** apuntando a este repo
   con el archivo `docker-compose.prod.yml`.
3. Dominio sobre el servicio `web`, puerto 3000, con HTTPS de Let's Encrypt
   (lo gestiona Traefik).
4. Variables de entorno en la interfaz de Dokploy — ver
   [.env.prod.example](.env.prod.example). `POSTGRES_PASSWORD` es obligatoria y
   **la API key nunca entra al repo**. Si el paquete de GHCR es privado, hay
   que registrar las credenciales del registry en Dokploy.

### Probar el stack de producción en local

```bash
mise run build-prod
docker compose -p nboprod -f docker-compose.prod.yml --env-file .env.prod up -d
./scripts/verify_contrato.sh http://localhost:3000/api
```

### Regenerar el dump

`deploy/nbo.sql.gz` está versionado para que el despliegue sea reproducible
desde un `git clone`. **Queda desfasado si cambias el pipeline**, así que
después de cualquier cambio hay que regenerarlo y commitearlo:

```bash
mise run pipeline && mise run dump
```

### Notas de operación

- **Postgres no publica puerto**: solo se le llega por la red interna del
  compose. En un VPS, publicarlo sería exponerlo a Internet.
- **Techos de memoria** de 512 MB por servicio. No es por nuestro consumo —que
  es de ~185 MB— sino porque el VPS comparte 4 GB con otros proyectos: sin
  límite, un pico nuestro haría que el OOM killer del kernel matara
  contenedores ajenos.
- **Re-sembrar la base**: `initdb.d` solo corre con el volumen vacío. Para
  recargar datos hay que borrar el volumen `pgdata` y redesplegar.
- El endpoint del copiloto es **público y sin autenticación**, por decisión de
  producto. Acota el tamaño y la cantidad de mensajes por request para que un
  bucle del frontend o un payload gigante no quemen la cuota, pero no limita
  peticiones por IP. Si durante el evento el consumo se dispara, ese límite se
  añade en
  [chat/route.ts](web/src/app/api/copiloto/chat/route.ts).

## Documentación

| Documento | Qué contiene |
|---|---|
| [docs/contrato_datos.md](docs/contrato_datos.md) | Contrato de la API. Fuente de verdad entre pipeline, backend y frontend |
| [docs/hallazgos_datos.md](docs/hallazgos_datos.md) | EDA: qué lógica codifica realmente el dataset y cómo cambió el diseño |
| `pipeline/artifacts/model_card.md` | Generado por el pipeline: AUC, lift por decil, calibración, decisiones de marcado |

## Reglas no negociables del proyecto

- Sin columnas post-resultado como features del Modelo A (`motivo_rechazo`,
  `es_rebate`, `contactabilidad`, `medio_probatorio`, `resultado`). Hay un
  `assert` que aborta el entrenamiento si alguna aparece en `X`.
- Split temporal, nunca aleatorio.
- `pendiente` excluido del Modelo A; es el universo del Modelo B.
- El LLM no decide ofertas ni inventa cifras.
- La API key nunca llega al navegador; ningún SDK de proveedor se importa fuera
  de `web/src/ai/provider.ts`.
- Sin `shap`, MLflow, Optuna ni MLOps. Sin tuning de hiperparámetros.
- Sin factorización matricial ni embeddings: son 22 ofertas, es un ranking.
- El motor es general al portafolio. MT es un caso, no el motor.
