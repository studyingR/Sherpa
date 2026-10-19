import { networkInterfaces } from 'node:os';
import { buildApp, primeAlerts } from './app';
import { startScheduler } from './jobs/scheduler';

async function main() {
  const { app, deps, services } = await buildApp();
  await primeAlerts(deps, services);
  const stopScheduler = deps.config.SCHEDULER === 'on' ? startScheduler(deps, services) : () => undefined;
  await app.listen({ port: deps.config.PORT, host: deps.config.HOST });
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  deps.log.info(
    { llm: deps.config.LLM_MODE, voice: deps.config.VOICE_MODE, integrations: deps.config.INTEGRATIONS_MODE, clock: deps.clock.now().toISOString(), lan: lan ? `http://${lan}:${deps.config.PORT}` : undefined },
    'Sherpa server ready',
  );
  const shutdown = async () => {
    stopScheduler();
    await app.close();
    await deps.db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
