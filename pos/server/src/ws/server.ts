import { Database } from "bun:sqlite";
import { createHandlers, WsData } from "./handlers";

export function createWsServer(db: Database) {
  const { open, close, message } = createHandlers(db);

  return {
    open,
    close,
    message,
    drain(ws: any) {},
    // Heartbeat — disconnect silent clients after 30s
    idleTimeout: 30,
  };
}
