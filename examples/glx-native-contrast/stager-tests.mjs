import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse the baseline contracts with an explicit, allowlisted sibling variant.
process.argv.push('--variant-dir', path.dirname(fileURLToPath(import.meta.url)));
await import('../glx-native-validation/stager-tests.mjs');
