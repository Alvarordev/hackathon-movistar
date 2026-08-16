import { CANALES, getPrioridades } from "@/lib/queries";
import { fail, handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const foco = url.searchParams.get("foco") ?? "mt";
  const canal = url.searchParams.get("canal") ?? undefined;
  const soloNunca = url.searchParams.get("solo_nunca_ofertados") === "true";
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  if (foco !== "mt" && foco !== "todos") {
    return fail("parametro_invalido", "foco debe ser 'mt' o 'todos'");
  }
  if (canal && !CANALES.includes(canal as never)) {
    return fail("parametro_invalido", `canal debe ser uno de: ${CANALES.join(", ")}`);
  }
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isInteger(limit) || limit! < 1)) {
    return fail("parametro_invalido", "limit debe ser un entero positivo");
  }
  const offset = offsetRaw ? Number(offsetRaw) : undefined;
  if (offsetRaw && (!Number.isInteger(offset) || offset! < 0)) {
    return fail("parametro_invalido", "offset debe ser un entero >= 0");
  }

  return ok(
    await getPrioridades({
      foco,
      canal,
      soloNuncaOfertados: soloNunca,
      limit,
      offset,
    }),
  );
});
