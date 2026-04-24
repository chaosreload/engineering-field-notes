import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Engineering Field Notes',
  description: 'Hands-on deep dives into exceptional open-source projects — real notes from actually running, breaking, and understanding them.',
  base: '/engineering-field-notes/',
  ignoreDeadLinks: true,
  srcExclude: ['**/_drafts/**'],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/engineering-field-notes/favicon.svg' }]
  ],

  themeConfig: {
    siteTitle: '🔬 Engineering Field Notes',

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
            { text: 'Archon', link: '/ai-agents/Archon' },
            { text: 'Claude Code Game Studios', link: '/ai-agents/Claude-Code-Game-Studios' },
            { text: 'NitroGen — 通用游戏 Agent 基础模型', link: '/ai-agents/NitroGen' },
            { text: 'google/adk-python', link: '/ai-agents/adk-python' },
            { text: 'agent-skills', link: '/ai-agents/agent-skills' },
            { text: 'ai-hedge-fund', link: '/ai-agents/ai-hedge-fund' },
            { text: 'Project AIRI', link: '/ai-agents/airi' },
            { text: 'autoresearch', link: '/ai-agents/autoresearch' },
            { text: 'awesome-ai-ideas', link: '/ai-agents/awesome-ai-ideas' },
            { text: 'claude-agent-sdk-python', link: '/ai-agents/claude-agent-sdk-python' },
            { text: 'crewAI', link: '/ai-agents/crewai' },
            { text: 'deepagents', link: '/ai-agents/deepagents' },
            { text: 'bytedance/deer-flow', link: '/ai-agents/deer-flow' },
            { text: 'hermes-agent', link: '/ai-agents/hermes-agent' },
            { text: 'multica', link: '/ai-agents/multica' },
            { text: 'oh-my-claudecode', link: '/ai-agents/oh-my-claudecode' },
            { text: 'OpenClaw', link: '/ai-agents/openclaw' },
            { text: 'OpenSRE：给 AI SRE Agent 配一套 SWE-bench 式的评测基建', link: '/ai-agents/opensre' },
            { text: 'pydantic/pydantic-ai Study Notes', link: '/ai-agents/pydantic-ai' },
            { text: 'strands-agents/sdk-python', link: '/ai-agents/strands-agents-sdk-python' },
          ]
        }
      ],
      '/ai-infra/': [
        {
          text: '🏗️ AI Infrastructure',
          items: [
            { text: 'Overview', link: '/ai-infra/' },
            { text: 'E2B', link: '/ai-infra/E2B' },
            { text: 'OmniVoice', link: '/ai-infra/OmniVoice' },
            { text: 'Pixelle-Video', link: '/ai-infra/Pixelle-Video' },
            { text: 'VibeVoice', link: '/ai-infra/VibeVoice' },
            { text: 'claude-context', link: '/ai-infra/claude-context' },
            { text: 'claude-mem：给 Claude Code 加一层会话记忆', link: '/ai-infra/claude-mem' },
            { text: 'Google AI Edge Gallery', link: '/ai-infra/gallery' },
            { text: 'e2b-dev/infra', link: '/ai-infra/infra' },
            { text: 'kiro-gateway', link: '/ai-infra/kiro-gateway' },
            { text: 'kiro2api', link: '/ai-infra/kiro2api' },
            { text: 'New API', link: '/ai-infra/new-api' },
            { text: 'TimesFM', link: '/ai-infra/timesfm' },
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
            { text: 'MoneyPrinterV2', link: '/tools/MoneyPrinterV2' },
            { text: 'OpenSpec', link: '/tools/OpenSpec' },
            { text: 'AI Game DevTools — AI 游戏开发工具全景图', link: '/tools/ai-game-devtools' },
            { text: 'andrej-karpathy-skills', link: '/tools/andrej-karpathy-skills' },
            { text: 'awesome-design-md', link: '/tools/awesome-design-md' },
            { text: 'Cedar vs OPA：策略引擎深度对比', link: '/tools/cedar-vs-opa' },
            { text: 'Cedar 策略语言入门', link: '/tools/cedar' },
            { text: 'Claude Code — Source Code Deep Dive', link: '/tools/claude-code' },
            { text: 'claude-howto', link: '/tools/claude-howto' },
            { text: 'claude-hud', link: '/tools/claude-hud' },
            { text: 'darwin-skill', link: '/tools/darwin-skill' },
            { text: 'follow-builders', link: '/tools/follow-builders' },
            { text: 'last30days-skill', link: '/tools/last30days-skill' },
            { text: 'Lightpanda Browser', link: '/tools/lightpanda-browser' },
            { text: 'OPA (Open Policy Agent)', link: '/tools/opa' },
            { text: 'OpenScreen', link: '/tools/openscreen' },
            { text: 'RTK (Rust Token Killer)', link: '/tools/rtk' },
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
