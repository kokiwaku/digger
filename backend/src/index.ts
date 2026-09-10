import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { pingDatabase } from "./db.js";

const PORT = Number(process.env.PORT ?? 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

const app = new Hono();

app.use("/api/*", cors({ origin: FRONTEND_ORIGIN }));

app.get("/api/health", (c) => {
  return c.json({ status: "ok", service: "digger-backend" });
});

app.get("/api/health/db", async (c) => {
  try {
    await pingDatabase();
    return c.json({ status: "ok", db: "connected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return c.json({ status: "error", db: "disconnected", message }, 503);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`digger-backend listening on http://localhost:${info.port}`);
});
