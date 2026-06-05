import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/nip02.ts',
    'src/nip09.ts',
    'src/nip10.ts',
    'src/nip18.ts',
    'src/nip23.ts',
    'src/nip25.ts',
    'src/nip27.ts',
    'src/nip47.ts',
    'src/nip51.ts',
    'src/nip57.ts',
    'src/nip59.ts',
    'src/nip17.ts',
    'src/nip98.ts',
    'src/kinds.ts',
    'src/media.ts',
    'src/moderation.ts',
    'src/discovery.ts',
    'src/extra.ts',
  ],
  format: 'esm',
  platform: 'neutral',
  dts: true,
  clean: true,
})
