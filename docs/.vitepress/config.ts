import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Engineering Field Notes',
  description: 'Hands-on deep dives into exceptional open-source projects — real notes from actually running, breaking, and understanding them.',
  base: '/engineering-field-notes/',
  ignoreDeadLinks: true,
  srcExclude: ['**/_drafts/**'],

  head: [
    ['link', { rel: 'icon', href: '/engineering-field-notes/favicon.ico' }]
  ],

  themeConfig: {
    logo: '🔬',
    siteTitle: 'Engineering Field Notes',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'AI Agents', link: '/ai-agents/' },
      { text: 'AI Infra', link: '/ai-infra/' },
      { text: 'Databases', link: '/databases/' },
      { text: 'Protocols', link: '/protocols/' },
      { text: 'Tools', link: '/tools/' }
    ],

    sidebar: {
      '/ai-agents/': [
        {
          text: '🤖 AI Agents',
          items: [
            { text: 'Overview', link: '/ai-agents/' },
            { text: 'ai-hedge-fund', link: '/ai-agents/ai-hedge-fund' },
            { text: 'Project AIRI', link: '/ai-agents/airi' },
            { text: 'autoresearch', link: '/ai-agents/autoresearch' },
            { text: 'deepagents', link: '/ai-agents/deepagents' },
          ]
        }
      ],
      '/ai-infra/': [
        {
          text: '🏗️ AI Infrastructure',
          items: [
            { text: 'Overview', link: '/ai-infra/' },
            { text: 'E2B', link: '/ai-infra/E2B' },
            { text: 'kiro-gateway', link: '/ai-infra/kiro-gateway' },
            { text: 'zeroboot', link: '/ai-infra/zeroboot' },
          ]
        }
      ],
      '/databases/': [
        {
          text: '🗄️ Databases',
          items: [
            { text: 'Overview', link: '/databases/' },
            { text: 'SpacetimeDB', link: '/databases/spacetimedb' },
          ]
        }
      ],
      '/protocols/': [
        {
          text: '🔌 Protocols',
          items: [
            { text: 'Overview', link: '/protocols/' },
            { text: 'ACP (Agent Client Protocol)', link: '/protocols/agent-client-protocol' },
          ]
        }
      ],
      '/tools/': [
        {
          text: '🛠️ Tools',
          items: [
            { text: 'Overview', link: '/tools/' },
            { text: 'Lightpanda Browser', link: '/tools/lightpanda-browser' },
            { text: 'worldmonitor', link: '/tools/worldmonitor' },
          ]
        }
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/chaosreload/engineering-field-notes' }
    ],

    footer: {
      message: 'Real notes from real engineering exploration.',
      copyright: 'Copyright © 2026 chaosreload'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/chaosreload/engineering-field-notes/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'short'
      }
    }
  },

  lastUpdated: true,
})
