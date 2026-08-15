/**
 * ÚNICO módulo del proyecto que importa un SDK de proveedor de IA.
 *
 * Cambiar de Gemini a Claude o a OpenAI es cambiar dos variables de entorno:
 * no se toca una línea de lógica de aplicación. Nada fuera de este archivo
 * puede importar `@ai-sdk/*`.
 *
 * La API key vive solo en el servidor. El navegador nunca la ve porque el
 * loop de tool calling corre acá.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type Proveedor = "google" | "anthropic" | "openai";

const MODELO_POR_DEFECTO: Record<Proveedor, string> = {
  google: "gemini-2.0-flash",
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
};

const VAR_API_KEY: Record<Proveedor, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export class ProveedorNoConfigurado extends Error {}

export function proveedorActual(): Proveedor {
  const p = (process.env.AI_PROVIDER ?? "google").toLowerCase();
  if (p !== "google" && p !== "anthropic" && p !== "openai") {
    throw new ProveedorNoConfigurado(
      `AI_PROVIDER="${p}" no es válido. Usar: google | anthropic | openai`,
    );
  }
  return p;
}

export function modeloActual(): string {
  return process.env.AI_MODEL || MODELO_POR_DEFECTO[proveedorActual()];
}

export function estaConfigurado(): boolean {
  try {
    return Boolean(process.env[VAR_API_KEY[proveedorActual()]]);
  } catch {
    return false;
  }
}

export function getModelo(): LanguageModel {
  const proveedor = proveedorActual();
  const apiKey = process.env[VAR_API_KEY[proveedor]];
  if (!apiKey) {
    throw new ProveedorNoConfigurado(
      `Falta ${VAR_API_KEY[proveedor]} en el entorno para AI_PROVIDER=${proveedor}.`,
    );
  }
  const modelo = modeloActual();

  switch (proveedor) {
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelo);
    case "anthropic":
      return createAnthropic({ apiKey })(modelo);
    case "openai":
      return createOpenAI({ apiKey })(modelo);
  }
}
