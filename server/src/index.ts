import { fileURLToPath } from 'node:url';
import { createNexus } from './app.ts';

const port = Number(process.env.PORT ?? 3001);
const nexus = createNexus({
  dbPath: process.env.DATABASE_PATH ?? fileURLToPath(new URL('../nexus.db', import.meta.url)),
  staticDir: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  secureCookies: process.env.NODE_ENV === 'production',
});

nexus.server.listen(port, () => {
  console.log(`Project Nexus server listening on http://localhost:${port}`);
});
