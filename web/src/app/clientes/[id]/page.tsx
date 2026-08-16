import Link from "next/link";
import { UserX } from "lucide-react";

import { Cockpit } from "@/components/cockpit/Cockpit";
import { Panel, Vacio } from "@/components/ui/Base";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CockpitPage({ params }: Props) {
  const { id } = await params;

  const [cliente, nbo, journey] = await Promise.all([
    api.cliente(id),
    api.nbo(id),
    api.journey(id),
  ]);

  if (!cliente || !nbo) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Panel>
          <Vacio
            icono={<UserX size={24} />}
            titulo={`No existe el cliente ${id}`}
            detalle="Verifica el identificador. Los IDs tienen el formato CLI000013."
          />
          <div className="text-center">
            <Link
              href="/"
              className="text-cuerpo font-medium text-acento hover:underline"
            >
              Volver a la cola
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  return <Cockpit cliente={cliente} journey={journey} nboInicial={nbo} />;
}
