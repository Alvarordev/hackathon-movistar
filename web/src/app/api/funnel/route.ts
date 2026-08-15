import { CANALES, getFunnel } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const canal = new URL(req.url).searchParams.get("canal") ?? undefined;
  if (canal && !CANALES.includes(canal as never)) {
    return fail("parametro_invalido", `canal debe ser uno de: ${CANALES.join(", ")}`);
  }
  const f = await getFunnel(canal);
  if (!f) {
    return fail("artefactos_no_disponibles", "Ejecutar el pipeline y el seed");
  }
  return ok(f);
});
