import { app } from "./app.ts";
import { env } from "./env.ts";

app.listen({ port: env.PORT, hostname: env.HOST });

console.log(
  `incendio-k8s agent listening on http://${env.HOST}:${env.PORT} (OpenAPI at /openapi)`,
);
