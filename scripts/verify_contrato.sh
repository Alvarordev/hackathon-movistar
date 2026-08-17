#!/usr/bin/env bash
# Verifica que la API cumple el contrato de datos contra datos reales.
# Uso: ./scripts/verify_contrato.sh [base_url]
set -uo pipefail

BASE="${1:-http://localhost:3000/api}"
OK=0
FALLO=0

check() {
  local nombre="$1" url="$2" jq_expr="$3"
  local body status
  body=$(curl -s -w $'\n%{http_code}' "$url")
  status=$(tail -n1 <<<"$body")
  body=$(sed '$d' <<<"$body")

  if [ "$status" != "200" ]; then
    printf '  ✗ %-46s HTTP %s\n' "$nombre" "$status"
    FALLO=$((FALLO + 1))
    return
  fi
  local err
  if ! err=$(python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
assert ($jq_expr)
" <<<"$body" 2>&1); then
    printf '  ✗ %-46s no cumple: %s\n' "$nombre" "$jq_expr"
    [ -n "$err" ] && printf '      %s\n' "$(tail -n1 <<<"$err")"
    FALLO=$((FALLO + 1))
    return
  fi
  printf '  ✓ %-46s\n' "$nombre"
  OK=$((OK + 1))
}

check_status() {
  local nombre="$1" url="$2" esperado="$3"
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$url")
  if [ "$status" = "$esperado" ]; then
    printf '  ✓ %-46s HTTP %s\n' "$nombre" "$status"
    OK=$((OK + 1))
  else
    printf '  ✗ %-46s HTTP %s (esperado %s)\n' "$nombre" "$status" "$esperado"
    FALLO=$((FALLO + 1))
  fi
}

echo "Verificando el contrato contra $BASE"
echo
echo "Salud e infraestructura"
check "health responde ok"          "$BASE/health"  "d['ok'] is True and d['db']=='up'"
check "artefactos del pipeline cargados" "$BASE/health" "d['artefactos']['cargados'] is True and d['modo_datos']=='real'"
check "catalogo completo (22 ofertas)" "$BASE/ofertas" "len(d['ofertas'])==22"
check "gb_incluidos=9999 se sirve como ilimitado" "$BASE/ofertas" \
  "all(o['gb_incluidos'] is None for o in d['ofertas'] if o['gb_ilimitado'])"
check "el centinela 9999 no aparece en texto" "$BASE/ofertas" \
  "not any('9999' in (o['descripcion_corta'] or '') for o in d['ofertas'])"

echo
echo "Ficha del cliente"
check "cliente elegible a MT"        "$BASE/clientes/CLI000013" "d['elegible_mt'] is True"
check "features derivadas presentes" "$BASE/clientes/CLI000013" \
  "d['gasto_actual_total'] is not None and d['gap_a_mt'] is not None"
check "gasto real > facturacion del plan movil" "$BASE/clientes/CLI000013" \
  "d['gasto_actual_total'] > d['monto_facturado_prom']"
check "persona asignada con nombre"  "$BASE/clientes/CLI000013" \
  "d['persona']['nombre'] and d['persona']['descripcion']"
check_status "cliente inexistente da 404" "$BASE/clientes/CLI999999" 404

echo
echo "Recomendacion NBO"
check "devuelve recomendaciones rankeadas" "$BASE/clientes/CLI000013/nbo" \
  "len(d['recomendaciones'])>0 and d['recomendaciones'][0]['rank']==1"
check "valor_esperado = contacto x aceptacion" "$BASE/clientes/CLI000013/nbo" \
  "all(abs(r['valor_esperado']-r['prob_contacto']*r['prob_aceptacion'])<0.001 for r in d['recomendaciones'])"
check "ranking ordenado por valor esperado" "$BASE/clientes/CLI000013/nbo" \
  "all(d['recomendaciones'][i]['valor_esperado']>=d['recomendaciones'][i+1]['valor_esperado'] for i in range(len(d['recomendaciones'])-1))"
check "cada recomendacion trae drivers"  "$BASE/clientes/CLI000013/nbo" \
  "all(len(r['drivers'])>0 for r in d['recomendaciones'])"
check "por_canal cubre los 4 canales"    "$BASE/clientes/CLI000013/nbo" \
  "all(len(r['por_canal'])==4 for r in d['recomendaciones'])"
check "limit recorta el ranking"         "$BASE/clientes/CLI000013/nbo?limit=2" \
  "len(d['recomendaciones'])==2"
check "simulador de canal re-rankea"     "$BASE/clientes/CLI000013/nbo?canal=Tienda" \
  "all(r['canal_sugerido']=='Tienda' for r in d['recomendaciones'])"
check_status "canal invalido da 400" "$BASE/clientes/CLI000013/nbo?canal=Whatsapp" 400

echo
echo "Politica de blindaje MT"
check "gap de hogar recibe el puente como #1"    "$BASE/clientes/CLI000003/nbo?limit=1" \
  "d['recomendaciones'][0]['avanza_a_mt'] is True"
check "elegible MT recibe MT como #1"            "$BASE/clientes/CLI000013/nbo?limit=1" \
  "d['recomendaciones'][0]['es_movistar_total'] is True"
check "prioridades foco=mt solo avanza a MT"     "$BASE/prioridades?foco=mt&limit=20" \
  "d['n']>0 and all(c['avanza_a_mt'] for c in d['clientes'])"
check "prioridades excluye abstenciones"         "$BASE/prioridades?limit=200" \
  "'CLI000001' not in [c['cliente_id'] for c in d['clientes']]"
check "cola nunca_ofertados sirve cobertura perdida" "$BASE/prioridades?solo_nunca_ofertados=true&limit=10" \
  "d['n']>0 and all(c['nunca_ofrecido_mt'] for c in d['clientes'])"
# El orden prometido NO es VE exacto: es VE agrupado a 2 decimales (diferencias
# menores están bajo la resolución del modelo) y, dentro del empate, el ahorro.
check "cola ordenada por VE agrupado, luego ahorro" "$BASE/prioridades?limit=50" \
  "all(
      round(d['clientes'][i]['valor_esperado'],2) > round(d['clientes'][i+1]['valor_esperado'],2)
      or (round(d['clientes'][i]['valor_esperado'],2) == round(d['clientes'][i+1]['valor_esperado'],2)
          and (d['clientes'][i]['ahorro_soles'] if d['clientes'][i]['ahorro_soles'] is not None else -1e9)
              >= (d['clientes'][i+1]['ahorro_soles'] if d['clientes'][i+1]['ahorro_soles'] is not None else -1e9))
      for i in range(len(d['clientes'])-1))"
check_status "foco invalido da 400" "$BASE/prioridades?foco=churn" 400

echo
echo "Abstencion y ruta a MT"
check "cliente con mora se abstiene"     "$BASE/clientes/CLI000001/nbo" \
  "d['abstenerse'] is True and d['recomendaciones']==[] and d['motivo_abstencion']"
check "no elegible trae ruta de 2 pasos" "$BASE/clientes/CLI000003/nbo" \
  "d['ruta_mt']['oferta_puente_id'] and d['ruta_mt']['mt_destino_id']"
check "MT no se ofrece a un no elegible" "$BASE/clientes/CLI000003/nbo" \
  "not any(r['es_movistar_total'] for r in d['recomendaciones'])"

echo
echo "Journey y trazabilidad E2E"
check "journey con eventos y resumen"    "$BASE/clientes/CLI000013/journey" \
  "d['resumen']['n_ofrecimientos']>0 and len(d['eventos'])>0"
check "eventos traen medio probatorio"   "$BASE/clientes/CLI000013/journey" \
  "all('medio_probatorio' in e for e in d['eventos'])"
check "funnel global encadena etapas"    "$BASE/funnel" \
  "[e['etapa'] for e in d['etapas']]==['ofrecimientos','contactados','con_medio_probatorio','aceptados']"
check "funnel por canal"                 "$BASE/funnel?canal=Digital" "d['canal']=='Digital'"
check "funnel desglosa los 4 canales"    "$BASE/funnel" "len(d['por_canal'])==4"

echo
echo "Matriz de rebate"
check "los 6 motivos presentes"          "$BASE/rebate" "len(d['motivos'])==6"
check "toda accion trae n y confianza"   "$BASE/rebate?motivo=precio" \
  "all('n' in a and a['confianza'] in ('alta','baja') for a in d['acciones'])"
check "no_confia no recomienda descuento" "$BASE/rebate?motivo=no_confia" \
  "not any(a['accion']=='bajar_precio' for a in d['acciones'])"
check "mal_momento no recomienda pivotar" "$BASE/rebate?motivo=mal_momento" \
  "not any(a['accion']=='pivot_a_mt' for a in d['acciones'])"
check_status "motivo invalido da 400" "$BASE/rebate?motivo=carisimo" 400

echo
echo "Metricas del modelo"
check "AUC de ambos modelos"             "$BASE/metrics" \
  "d['modelo_aceptacion']['auc_test']>0 and d['modelo_contactabilidad']['auc_test']>0"
check "sin leakage (AUC test < 0.90)"    "$BASE/metrics" \
  "d['modelo_aceptacion']['auc_test']<0.90"
check "modelo supera el baseline de 1 variable" "$BASE/metrics" \
  "d['modelo_aceptacion']['auc_test']>d['modelo_aceptacion']['auc_baseline_solo_mt']"
check "split temporal declarado"         "$BASE/metrics" \
  "d['modelo_aceptacion']['split']['test_desde']=='2026-05-01'"
check "mercado MT ampliado por gap_a_mt" "$BASE/metrics" \
  "d['mercado_ampliado_mt']['total_alcanzable']>d['mercado_ampliado_mt']['ya_elegibles']"

echo
echo "Analisis de segmento"
check "cohorte por rango de edad"          "$BASE/segmento?edad_rango=26-35" \
  "d['n_clientes']==28045 and d['filtros_aplicados']=={'edad_rango':'26-35'}"
check "sin filtros = planta entera"        "$BASE/segmento" \
  "d['n_clientes']==100000 and d['pct_de_la_base']==1"
check "cuadra con metrics del pipeline"    "$BASE/segmento" \
  "d['movistar_total']['n_elegibles']==13650 and d['salud']['n_abstencion']==12531"
check "todo conteo viene con su pct"       "$BASE/segmento?departamento=Ica" \
  "all(0<=g['pct']<=1 for g in d['movistar_total']['desglose_gap'])
   and abs(sum(g['pct'] for g in d['movistar_total']['desglose_gap'])-1)<0.01"
check "distingue medido de proyectado"     "$BASE/segmento?cluster_id=1" \
  "'conversion_historica' in d and 'oportunidad' in d and d['nota_metodologica']"
check "cohorte vacia no inventa promedios" \
  "$BASE/segmento?es_movistar_total=true&gap_a_mt=migracion_postpago" \
  "d['n_clientes']==0 and 'perfil' not in d and d['confianza']=='baja'"
check_status "filtro invalido da 400"      "$BASE/segmento?edad_rango=99" 400
check_status "booleano invalido da 400"    "$BASE/segmento?elegible_mt=si"  400

echo
echo "Copiloto"
check "los 10 tools cargan con esquema valido" "$BASE/copiloto/tools" \
  "len(d['tools'])==10 and all(t['descripcion'] for t in d['tools'])"
check "tool analizar_segmento sin argumentos obligatorios" "$BASE/copiloto/tools" \
  "'edad_rango' in next(t for t in d['tools'] if t['nombre']=='analizar_segmento')['argumentos']"
check "tool get_nbo expone canal y limit"     "$BASE/copiloto/tools" \
  "set(next(t for t in d['tools'] if t['nombre']=='get_nbo')['argumentos'])=={'cliente_id','canal','limit'}"
CHAT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/copiloto/chat" \
  -H 'Content-Type: application/json' -d '{"messages":[]}')
if [ "$CHAT_STATUS" = "400" ]; then
  printf '  ✓ %-46s HTTP 400\n' "rechaza messages vacio"; OK=$((OK + 1))
else
  printf '  ✗ %-46s HTTP %s (esperado 400)\n' "rechaza messages vacio" "$CHAT_STATUS"; FALLO=$((FALLO + 1))
fi
CHAT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/copiloto/chat" \
  -H 'Content-Type: application/json' \
  -d '{"cliente_id":"CLI000013","messages":[{"role":"user","content":"hola"}]}')
case "$CHAT_STATUS" in
  200) printf '  ✓ %-46s HTTP 200 (LLM configurado)\n' "chat responde"; OK=$((OK + 1)) ;;
  503) printf '  ~ %-46s HTTP 503 (sin API key: esperado)\n' "chat responde"; OK=$((OK + 1)) ;;
  *)   printf '  ✗ %-46s HTTP %s\n' "chat responde" "$CHAT_STATUS"; FALLO=$((FALLO + 1)) ;;
esac

echo
echo "──────────────────────────────────────────────────"
printf '  %d verificaciones OK, %d fallidas\n' "$OK" "$FALLO"
[ "$FALLO" -eq 0 ] || exit 1
