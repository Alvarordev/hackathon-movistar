import { queryOne } from "@/lib/db";
import { handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  let db = "down";
  let artefactos: { cargados: boolean; generado_en: string | null } = {
    cargados: false,
    generado_en: null,
  };

  try {
    await queryOne("SELECT 1");
    db = "up";
  } catch {
    return ok({ ok: false, db, artefactos, modo_datos: "desconocido" });
  }

  try {
    const row = await queryOne<{ generado_en: string }>(
      "SELECT max(generado_en) AS generado_en FROM artefactos",
    );
    if (row?.generado_en) {
      artefactos = { cargados: true, generado_en: row.generado_en };
    }
  } catch {
    // La tabla aún no existe: el pipeline no ha corrido. No es un fallo de salud.
  }

  return ok({
    ok: db === "up",
    db,
    artefactos,
    modo_datos: artefactos.cargados ? "real" : "fixtures",
  });
});
