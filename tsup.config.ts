import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
  },
  {
    entry: {
      invar: 'src/cli/index.ts',
    },
    format: ['esm'],
    outDir: 'bin',
    banner: {
      js: '#!/usr/bin/env node',
    },
    target: 'node20',
  },
]);
