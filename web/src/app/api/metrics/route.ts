import { getMetrics } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const m = await getMetrics();
  if (!m) {
    return fail("artefactos_no_disponibles", "Ejecutar el pipeline y el seed");
  }
  return ok(m);
});
