import { getJourney } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const journey = await getJourney(id);
  if (!journey) return fail("cliente_no_encontrado", `${id} no existe`);
  return ok(journey);
});
