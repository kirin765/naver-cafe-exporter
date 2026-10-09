import { loadConfig } from "./config";
import { openDb } from "./db";
import { HttpPaddleClient } from "./paddle";
import { createServer } from "./handlers";
import { createMailer } from "./mail";

function main(): void {
  const config = loadConfig();
  const store = openDb(config.dbPath);
  const paddle = new HttpPaddleClient(config.paddleApiKey, config.paddleEnv);
  const mailer = createMailer(
    config.smtpHost
      ? {
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpSecure,
          user: config.smtpUser,
          pass: config.smtpPass,
          from: config.smtpFrom
        }
      : null
  );
  const server = createServer({ store, paddle, config, now: () => Date.now(), mailer });

  server.listen(config.port, config.host, () => {
    console.log(`naver-cafe-exporter web listening on ${config.appBaseUrl} (${config.host}:${config.port})`);
    console.log(`paddle env: ${config.paddleEnv}`);
    console.log(`auth: magic-link (${mailer ? "smtp" : "dev-log"})`);
    if (!config.paddleApiKey) console.warn("PADDLE_API_KEY is not set; billing API calls will fail");
    if (!config.paddleWebhookSecret) console.warn("PADDLE_WEBHOOK_SECRET is not set; webhooks will be rejected");
    if (!mailer) console.warn("SMTP is not configured; magic links will not be emailed");
  });

  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
