import { getOfertas } from "@/lib/queries";
import { handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handler(async () => ok(await getOfertas()));
