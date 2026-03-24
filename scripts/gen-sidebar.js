#!/usr/bin/env node
/**
 * gen-sidebar.js
 * 扫描 docs/ 目录，自动生成 VitePress config.ts 中的 sidebar + nav
 * 用法：node scripts/gen-sidebar.js
 * 会直接覆写 docs/.vitepress/config.ts
 *
 * 分类配置（新增分类只需在 CATEGORIES 里加一行）
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_DIR = path.resolve(__dirname, '../docs')
const CONFIG_FILE = path.resolve(__dirname, '../docs/.vitepress/config.ts')

// 分类元信息：目录名 → { label, icon, navText }
const CATEGORIES = {
  'ai-agents':  { label: 'AI Agents',        icon: '🤖', navText: 'AI Agents' },
  'ai-infra':   { label: 'AI Infrastructure', icon: '🏗️', navText: 'AI Infra' },
  'databases':  { label: 'Databases',         icon: '🗄️', navText: 'Databases' },
  'protocols':  { label: 'Protocols',         icon: '🔌', navText: 'Protocols' },
  'tools':      { label: 'Tools',             icon: '🛠️', navText: 'Tools' },
}

// 从 md 文件第一行 # 标题提取展示名，fallback 为文件名 title-case
function getTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const match = content.match(/^#\s+(.+)/m)
    if (match) {
      // 去掉 "Getting Started" / "—" 及其后内容，只取项目名
      return match[1]
        .replace(/\s*[—–-]+\s*(Getting Started|学习笔记|入门指南).*$/i, '')
        .replace(/\s+(Getting Started|学习笔记|入门指南).*$/i, '')
        .trim()
    }
  } catch {}
  const base = path.basename(filePath, '.md')
  return base.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// 扫描某个分类目录，返回 sidebar items
function scanCategory(categoryDir, categoryKey) {
  if (!fs.existsSync(categoryDir)) return []
  const files = fs.readdirSync(categoryDir)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .sort()

  return files.map(f => {
    const stem = f.replace(/\.md$/, '')
    const title = getTitle(path.join(categoryDir, f))
    return { text: title, link: `/${categoryKey}/${stem}` }
  })
}

// 生成完整 sidebar 对象
function buildSidebar() {
  const sidebar = {}
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    const items = scanCategory(path.join(DOCS_DIR, key), key)
    sidebar[`/${key}/`] = [
      {
        text: `${meta.icon} ${meta.label}`,
        items: [
          { text: 'Overview', link: `/${key}/` },
          ...items,
        ]
      }
    ]
  }
  return sidebar
}

// 生成 nav 数组
function buildNav() {
  return [
    { text: 'Home', link: '/' },
    ...Object.entries(CATEGORIES).map(([key, meta]) => ({
      text: meta.navText,
      link: `/${key}/`,
    }))
  ]
}

// 把对象序列化为 TypeScript 对象字面量（无 JSON.stringify 引号问题）
function serializeNav(nav) {
  return nav.map(item =>
    `      { text: '${item.text}', link: '${item.link}' }`
  ).join(',\n')
}

function serializeSidebar(sidebar) {
  const lines = []
  for (const [path, groups] of Object.entries(sidebar)) {
    lines.push(`      '${path}': [`)
    for (const group of groups) {
      lines.push(`        {`)
      lines.push(`          text: '${group.text}',`)
      lines.push(`          items: [`)
      for (const item of group.items) {
        lines.push(`            { text: '${item.text}', link: '${item.link}' },`)
      }
      lines.push(`          ]`)
      lines.push(`        }`)
    }
    lines.push(`      ],`)
  }
  return lines.join('\n')
}

const nav = buildNav()
const sidebar = buildSidebar()

const configContent = `import { defineConfig } from 'vitepress'

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
${serializeNav(nav)}
    ],

    sidebar: {
${serializeSidebar(sidebar)}
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
`

fs.writeFileSync(CONFIG_FILE, configContent, 'utf-8')
console.log('✅ config.ts updated!')
console.log('   Nav:', nav.map(n => n.text).join(', '))
for (const [key, groups] of Object.entries(sidebar)) {
  const items = groups[0].items.filter(i => i.text !== 'Overview')
  console.log(`   ${key}: ${items.map(i => i.text).join(', ') || '(no docs yet)'}`)
}
