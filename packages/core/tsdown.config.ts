import { defineConfig } from 'tsdown'

export default defineConfig({
  // Entries expand as Phase 1 lands nip19/nip21/nip44 modules.
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true, // isolatedDeclarations is read from tsconfig automatically
  // exports:true (auto-generate package.json exports) re-enabled in Phase 1 once all entries exist.
  clean: true,
  treeshake: true,
})
