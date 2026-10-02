export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'focus-band': { style: number; tint: number; lang: 'zh' | 'en'; isReady: boolean; limits: RateLimit[] }
  }
}
