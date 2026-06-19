export const config = {
  // Server
  httpPort: parseInt(process.env.HTTP_PORT ?? "8080"),
  wsPort: parseInt(process.env.WS_PORT ?? "8081"),

  // mDNS
  serviceName: process.env.SERVICE_NAME ?? "mise-pos",
  serviceType: "_mise-pos._tcp",

  // SQLite (local master database)
  dbPath: process.env.DB_PATH ?? "./mise-pos.db",

  // Supabase (cloud sync)
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? "",

  // Auth
  masterPin: process.env.MASTER_PIN ?? "0000",
  jwtSecret: process.env.JWT_SECRET ?? "mise-pos-local-secret-change-me",

  // Sync
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS ?? "5000"),
  localRetentionHours: parseInt(process.env.LOCAL_RETENTION_HOURS ?? "48"),

  // Printer
  printerHost: process.env.PRINTER_HOST ?? "",
  kitchenPrinterHost: process.env.KITCHEN_PRINTER_HOST ?? "",
} as const;

export type Config = typeof config;
