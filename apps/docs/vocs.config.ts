import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Velvet',
  description: 'The Nostr toolkit that feels like velvet: every NIP, zero ceremony, runs anywhere TypeScript does.',
  iconUrl: '/velvet.svg',
  logoUrl: '/velvet.svg',
  accentColor: '#7c5cff',
  topNav: [
    { text: 'Guide', link: '/guide/getting-started', match: '/guide' },
    { text: 'NIPs', link: '/nips-coverage' },
    { text: 'Live demo', link: '/live' },
    { text: 'API', link: '/api', match: '/api' },
    { text: 'GitHub', link: 'https://github.com/beamhop/nostr' },
  ],
  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'Why Velvet', link: '/' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Live in the browser', link: '/live' },
      ],
    },
    {
      text: 'Guide',
      items: [
        { text: 'Identities & signers', link: '/guide/signers' },
        { text: 'Publishing', link: '/guide/publishing' },
        { text: 'Subscriptions', link: '/guide/subscriptions' },
        { text: 'Private DMs (NIP-17)', link: '/guide/dms' },
        { text: 'Outbox routing (NIP-65)', link: '/guide/outbox' },
        { text: 'Easy mode (agent)', link: '/guide/agent' },
        { text: 'Every NIP', link: '/guide/nips' },
      ],
    },
    {
      text: 'Packages',
      collapsed: true,
      items: [
        { text: '@hopstr/core', link: '/packages/core' },
        { text: '@hopstr/signers', link: '/packages/signers' },
        { text: '@hopstr/relay', link: '/packages/relay' },
        { text: '@hopstr/pool', link: '/packages/pool' },
        { text: '@hopstr/router', link: '/packages/router' },
        { text: '@hopstr/store', link: '/packages/store' },
        { text: '@hopstr/nips', link: '/packages/nips' },
        { text: '@hopstr/client', link: '/packages/client' },
        { text: '@hopstr/agent', link: '/packages/agent' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'NIP coverage', link: '/nips-coverage' },
        { text: 'Generated API', link: '/api' },
      ],
    },
  ],
})
