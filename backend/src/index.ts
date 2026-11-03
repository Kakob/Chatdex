import { buildApp } from './app.js';
import { db } from './db/index.js';

const app = await buildApp({ db });

const port = parseInt(process.env.PORT || '3003', 10);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`Server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
