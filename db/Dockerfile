# Postgres con la base del Copiloto NBO ya sembrada.
#
# Postgres ejecuta lo que encuentre en /docker-entrypoint-initdb.d en su primer
# arranque —y descomprime los .sql.gz de forma nativa—, así que la base queda
# poblada sola. Sin job de seed, sin orquestación, sin correr Python en el VPS.
#
# El dump lleva el esquema y los datos, por eso NO se copian las migraciones de
# db/migrations: correrían dos veces sobre lo mismo.
#
# OJO: initdb.d solo corre cuando el volumen de datos está vacío. Para
# re-sembrar hay que borrar el volumen y volver a desplegar.
#
# Regenerar el dump tras cambiar el pipeline:  mise run dump
FROM postgres:16-alpine

COPY deploy/nbo.sql.gz /docker-entrypoint-initdb.d/nbo.sql.gz
