import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.argv.push('--variant-dir', path.dirname(fileURLToPath(import.meta.url)));
await import('../glx-native-validation/stager-tests.mjs');
