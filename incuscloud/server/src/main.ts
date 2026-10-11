import { readFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";
import { createFront } from "./front.ts";
import { log, setLogLevel } from "./lib/log.ts";

const config = loadConfig(process.env);
setLogLevel(config.logLevel);

const app = createApp({});
const server = createFront({
  app,
  tls: { cert: readFileSync(config.tls.certFile), key: readFileSync(config.tls.keyFile) },
});
server.listen(config.listen.port, config.listen.host, () => log.info("listening", config.listen));
