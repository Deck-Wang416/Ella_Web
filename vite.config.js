import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

export default defineConfig({
  plugins: [react(), dailyMockApiPlugin()],
});

function dailyMockApiPlugin() {
  const mockDir = path.resolve(process.cwd(), "mock");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  async function readDailyFile(date) {
    const filePath = path.join(mockDir, `${date}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  return {
    name: "daily-mock-api",
    configureServer(server) {
      server.middlewares.use("/api/daily", async (req, res) => {
        try {
          const url = req.url || "/";
          const pathname = url.split("?")[0];

          if (req.method === "GET" && pathname === "/") {
            const files = await fs.readdir(mockDir);
            const dates = files
              .filter((file) => file.endsWith(".json"))
              .map((file) => file.replace(".json", ""))
              .sort();
            const list = await Promise.all(
              dates.map(async (date) => {
                const json = await readDailyFile(date);
                return {
                  date: json.date,
                  hasInteraction: Boolean(json.dashboard?.hasInteraction),
                  submitted: Boolean(json.diary?.submitted),
                };
              })
            );

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(list));
            return;
          }

          if (req.method === "GET" && pathname.startsWith("/")) {
            const date = pathname.slice(1);
            if (!datePattern.test(date)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "invalid date path" }));
              return;
            }
            const json = await readDailyFile(date);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(json));
            return;
          }

          if (req.method === "PUT" && pathname.startsWith("/")) {
            const date = pathname.slice(1);
            if (!datePattern.test(date)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "invalid date path" }));
              return;
            }
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!body || body.date !== date) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "date mismatch" }));
              return;
            }

            const filePath = path.join(mockDir, `${date}.json`);
            await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}
