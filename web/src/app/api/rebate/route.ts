import { MOTIVOS, getRebate } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const motivo = new URL(req.url).searchParams.get("motivo") ?? undefined;
  if (motivo && !MOTIVOS.includes(motivo as never)) {
    return fail("parametro_invalido", `motivo debe ser uno de: ${MOTIVOS.join(", ")}`);
  }
  const r = await getRebate(motivo);
  if (!r) {
    return fail("artefactos_no_disponibles", "Ejecutar el pipeline y el seed");
  }
  return ok(r);
});
