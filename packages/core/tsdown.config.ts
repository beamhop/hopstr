import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/nip19.ts', 'src/nip21.ts', 'src/nip44.ts'],
  format: 'esm',
  platform: 'neutral',
  dts: true, // isolatedDeclarations is read from tsconfig automatically
  // We keep a hand-written exports map: source-pointing `exports` for in-repo dev
  // (so the workspace resolves without a build) + `publishConfig.exports` (dist)
  // that npm swaps in on publish. tsdown's auto-exports would clobber that split.
  clean: true,
  treeshake: true,
})
