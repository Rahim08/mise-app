import { Bonjour } from "bonjour-service";

let bonjour: Bonjour | null = null;

export function registerMdns(port: number, name = "mise-pos") {
  bonjour = new Bonjour();

  const service = bonjour.publish({
    name,
    type: "mise-pos",
    port,
    txt: {
      version: "1.0",
      app: "MisePOS",
    },
  });

  service.on("up", () => {
    console.log(`  mDNS: ${name}.local:${port} registered`);
  });

  service.on("error", (err: Error) => {
    console.error("  mDNS error:", err.message);
  });

  return service;
}

export function stopMdns() {
  bonjour?.destroy();
}
