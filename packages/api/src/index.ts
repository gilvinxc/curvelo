import "dotenv/config";
import { db } from "./db.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";

async function main() {
  const server = await buildApp();
  try {
    await server.listen({ port: config.port, host: "0.0.0.0" });
    console.log(`curvelo-api listening on :${config.port}`);
  } catch (err) {
    server.log.error(err);
    await db.$disconnect();
    process.exit(1);
  }
}

void main();
