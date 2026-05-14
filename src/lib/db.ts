// Barrel re-export of the local-first storage layer in ./db/.
// Kept so that `import { db, ... } from '../lib/db'` resolves without
// requiring every consumer to switch to `'../lib/db/index'`.

export * from './db/index';
