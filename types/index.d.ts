export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }
export type Focus = { goal: string; bottleneck: string; scope: string }

declare module 'claude-code' {
  interface PluginState {
    'focus-band': { focus: Focus | null; style: number; tint: number; isReady: boolean
    owner: string; limits: RateLimit[] }
  }
}
