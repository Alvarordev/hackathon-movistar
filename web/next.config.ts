import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  // Empaqueta el servidor con solo las dependencias que realmente usa, en vez
  // de arrastrar node_modules entero a la imagen de producción.
  output: "standalone",
};

export default nextConfig;
