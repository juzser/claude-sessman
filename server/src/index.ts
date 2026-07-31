import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const config = loadConfig();
const running = startServer(config);

// eslint-disable-next-line no-console
console.log(`claude-sessman server listening on http://${config.host}:${config.port}`);

function shutdown(): void {
  running
    .close()
    .catch(() => {})
    .finally(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
