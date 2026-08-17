import { loadEnv } from '../src/lib/env';

loadEnv();

import { initSchema, dbPath, closeDb } from '../src/lib/db/client';

initSchema();
console.log(`[db] sema uygulandi -> ${dbPath()}`);
closeDb();
