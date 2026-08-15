import { CANALES, getNbo } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const canal = url.searchParams.get("canal") ?? undefined;
  const limitRaw = url.searchParams.get("limit");

  if (canal && !CANALES.includes(canal as never)) {
    return fail("parametro_invalido", `canal debe ser uno de: ${CANALES.join(", ")}`);
  }
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || limit! < 1)) {
    return fail("parametro_invalido", "limit debe ser un entero positivo");
  }

  const nbo = await getNbo(id, { canal, limit });
  if (!nbo) return fail("cliente_no_encontrado", `${id} no existe`);
  return ok({ ...nbo, generado_en: new Date().toISOString() });
});
