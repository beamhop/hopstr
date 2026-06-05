import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Velvet',
  description: 'The Nostr toolkit that feels like velvet: every NIP, zero ceremony, runs anywhere TypeScript does.',
  iconUrl: '/velvet.svg',
  logoUrl: '/velvet.svg',
  accentColor: '#7c5cff',
  topNav: [
    { text: 'Guide', link: '/guide/getting-started', match: '/guide' },
    { text: 'Live demo', link: '/live' },
    { text: 'API', link: '/api', match: '/api' },
    { text: 'GitHub', link: 'https://github.com/nostragent/velvet' },
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
      ],
    },
    {
      text: 'Packages',
      collapsed: true,
      items: [
        { text: '@nostragent/agent', link: '/guide/agent' },
        { text: '@nostragent/nips', link: '/guide/nips' },
        { text: 'API reference', link: '/api' },
      ],
    },
  ],
})
