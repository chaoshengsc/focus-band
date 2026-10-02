import { describe, expect, mock, test } from 'claude-code/testing'

const HOUR = 60 * 60 * 1000
const pad = (n: number) => String(n).padStart(2, '0')

function world(on: any, store: Record<string, unknown> = {}, limits: any[] = []) {
  const clock = mock.clock(on)
  // 可以中途改的读数
  const live = { limits }
  // 自己的内存存储，好让测试看到写入了什么
  const kept: Record<string, unknown> = { lang: 'zh', ...store }
  on('store.get', ($: any, e: any) => ({ value: kept[e.key] }))
  on('store.set', ($: any, e: any) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', ($: any, e: any) => {
    delete kept[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: live.limits, context: { tokens: 0, window: 200_000, percent: 0 } },
  }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))

  return { clock, kept, live }
}

const start = ($: any, surface = 'desktop') => $.session.start({ surface, isInteractive: true, cwd: '/work' })

const mount = ($: any, surface: string, props: Record<string, unknown> = {}, component = 'AbovePrompt') =>
  $.ui.mount({
    plugin: 'focus-band',
    surface,
    component,
    props:
      component === 'SessionMode'
        ? { modes: ['focus'], ...props }
        : { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, ...props },
  })

const measure = ($: any, rateLimits: any[]) =>
  $.session.measure({ context: { window: 200_000 }, rateLimits, changed: ['rateLimits'] })

const band = async ($: any, args = '') => (await $.command.run({ command: 'band', args })).text as string

describe('focus-band', () => {
  test('输入框上方：标签、细进度条、数字不变色、重置时间；只画认识的窗口', async ($: any, on: any) => {
    const { clock } = world(on)
    await start($)
    const now = clock.now()
    const soon = new Date(now + 3 * HOUR)
    const later = new Date(now + 100 * HOUR)
    await measure($, [
      { kind: 'five_hour', percentUsed: 92.6, resetsAt: soon.toISOString() },
      { kind: 'seven_day', percentUsed: 81, resetsAt: later.toISOString() },
      { kind: 'spend_limit', percentUsed: 150, resetsAt: 'not a date' },
      { kind: 'seven_day_opus', percentUsed: 5 },
    ])

    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /opus/ })).toBeUndefined()
    // 数字始终是正文色，只有进度条变色：93% 错误色，81% 警告色
    expect((await ui.find({ type: 'Text', text: /^93%$/ }))?.props?.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^81%$/ }))?.props?.color).toBeUndefined()
    const bars = (await ui.findAll({ type: 'Svg' })).map((one: any) => String(one.props.source))
    expect(bars[0]).toMatch(/#d64545/)
    expect(bars[1]).toMatch(/#d9822b/)
    expect(await ui.find({ type: 'Text', text: /^100%\+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█|░/ })).toBeUndefined()
    expect(
      await ui.find({ type: 'Text', text: new RegExp(`^${pad(soon.getHours())}:${pad(soon.getMinutes())}$`) }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: new RegExp(`^${later.getMonth() + 1}/${later.getDate()}$`) }),
    ).toBeDefined()
    await ui.unmount()

    // 窄了去掉重置时间
    const narrow = await mount($, 'desktop', { bodyColumns: 40 })
    expect(await narrow.find({ type: 'Text', text: /^\d\d:\d\d$/ })).toBeUndefined()
    await narrow.unmount()

    // 终端没有矢量图，退回字符
    const term = await mount($, 'terminal')
    expect(await term.find({ type: 'Text', text: /^█{9}$/ })).toBeDefined()
    expect(await term.find({ type: 'Svg' })).toBeUndefined()
    await term.unmount()
  })

  test('页脚：额度画在模型名旁边', async ($: any, on: any) => {
    const { kept } = world(on)
    await start($)
    await measure($, [{ kind: 'five_hour', percentUsed: 40 }])
    expect(await band($, 'style 2')).toMatch(/2 页脚/)
    expect(kept.style).toBe(2)

    const footer = await mount($, 'desktop', {}, 'SessionMode')
    expect(await footer.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
    // 页脚只有文字：没有圆圈、线段、分隔点
    expect(await footer.find({ type: 'Text', text: /[○◔◑◕●━]/ })).toBeUndefined()
    expect(await footer.find({ type: 'Text', text: /·/ })).toBeUndefined()
    expect(await footer.find({ type: 'Svg' })).toBeUndefined()
    // 引擎原有的模式标签保留
    expect(await footer.find({ type: 'Text', text: /^focus/ })).toBeDefined()
    await footer.unmount()

    expect(await band($, 'style 3')).toMatch(/用法/)
    expect(await band($, 'style')).toMatch(/1 输入框上方/)
    expect(await band($)).toMatch(/用法：\/band color/)
    expect(await band($, '随便什么')).toMatch(/用法：\/band color/)
  })

  test('重启后上次的额度还在；会话没就绪也能画；旧版存的定位被清掉', async ($: any, on: any) => {
    const { kept } = world(on, {
      tint: 4,
      limits: [{ kind: 'five_hour', percentUsed: 41 }],
      'focus:s1': { goal: '旧终点', bottleneck: '旧瓶颈', scope: '' },
    })
    // 故意先不调用 session.start
    const early = await mount($, 'desktop')
    expect(await early.find({ type: 'Text', text: /^41%$/ })).toBeDefined()
    expect(String((await early.find({ type: 'Svg' }))?.props?.source)).toMatch(/#4a6fd8/)
    expect(await early.find({ type: 'Text', text: /旧瓶颈/ })).toBeUndefined()
    await early.unmount()

    await start($)
    expect(kept['focus:s1']).toBeUndefined()
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^41%$/ })).toBeDefined()
    await ui.unmount()
  })

  test('配色：命令和螃蟹按钮都能换；接近上限时警告色优先', async ($: any, on: any) => {
    const { kept } = world(on, {}, [{ kind: 'five_hour', percentUsed: 40 }])
    await start($)
    const ui = await mount($, 'desktop')
    const fill = async () => String((await ui.find({ type: 'Svg' }))?.props?.source)

    expect(await fill()).toMatch(/#6f6f6f/)
    expect(await band($, 'color 陶土')).toMatch(/4 陶土/)
    expect(await fill()).toMatch(/#d97757/)
    expect(kept.tint).toBe(3)
    expect(await band($, 'color 5')).toMatch(/5 雾蓝/)
    expect(await band($, 'color clay')).toMatch(/4 陶土/)
    expect(await band($, 'color')).toMatch(/5 雾蓝/)
    expect(await band($, 'color 99')).toMatch(/用法/)
    expect(await band($, 'color 粉')).toMatch(/用法/)

    // 螃蟹上叠的按钮：按一下换到下一个，按钮的 key 跟着配色走
    await ui.press({ key: 'tint4' })
    expect(await fill()).toMatch(/#5b8a5a/)
    expect(kept.tint).toBe(5)

    await measure($, [{ kind: 'five_hour', percentUsed: 85 }])
    expect(await fill()).toMatch(/#d9822b/)
    await ui.unmount()

    // 终端：文字按钮
    const term = await mount($, 'terminal')
    await term.press({ key: 'tint' })
    expect(kept.tint).toBe(6)
    await term.unmount()
  })

  test('窗口已重置或读数为空：不把旧数字当真，也不清空；工具调用后主动读', async ($: any, on: any) => {
    const { clock, kept, live } = world(on)
    await start($)
    const now = clock.now()
    await measure($, [
      { kind: 'five_hour', percentUsed: 93, resetsAt: new Date(now + HOUR).toISOString() },
      { kind: 'seven_day', percentUsed: 50, resetsAt: new Date(now + 100 * HOUR).toISOString() },
    ])
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^93%$/ })).toBeDefined()

    // 空读数：保留上一次的
    await measure($, [])
    expect(await ui.find({ type: 'Text', text: /^93%$/ })).toBeDefined()
    expect((kept.limits as any[]).length).toBe(2)
    await ui.unmount()

    // 过了重置时刻：5h 画成“—”；7d 不受影响
    await clock.advance(2 * HOUR)
    const later = await mount($, 'desktop')
    expect(await later.find({ type: 'Text', text: /^93%$/ })).toBeUndefined()
    expect(await later.find({ type: 'Text', text: /^—$/ })).toBeDefined()
    expect(await later.find({ type: 'Text', text: /^50%$/ })).toBeDefined()
    await later.unmount()

    // 工具调用之后主动读到新读数；子代理的调用不读；读数为空时不清
    live.limits = [{ kind: 'five_hour', percentUsed: 7 }]
    await $.tool.call({ tool: 'Read', agentId: 'sub1' })
    expect((kept.limits as any[])[0].percentUsed).toBe(93)
    await $.tool.call({ tool: 'Read' })
    expect((kept.limits as any[])[0].percentUsed).toBe(7)
    live.limits = []
    await $.tool.call({ tool: 'Read' })
    expect((kept.limits as any[])[0].percentUsed).toBe(7)
  })

  test('英文界面：命令回复是英文；可切换并记住', async ($: any, on: any) => {
    const { kept } = world(on, { lang: 'en' })
    await start($)
    expect(await band($, 'color clay')).toMatch(/Band color: 4 Clay/)
    expect(await band($)).toMatch(/Usage: \/band color/)
    expect(await band($, 'lang fr')).toMatch(/Usage/)
    expect(await band($, 'lang')).toMatch(/中文/)
    expect(kept.lang).toBe('zh')
    expect(await band($, 'style 2')).toMatch(/2 页脚/)
  })
  test('同一栏里别的插件画的内容留着，叠在额度栏上面', async ($: any, on: any) => {
    world(on, {}, [{ kind: 'five_hour', percentUsed: 40 }])
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)

      return (globalThis as any).h(Text, {}, '别的插件')
    })
    await start($)
    const ui = await mount($, 'desktop')
    const seen = (await ui.findAll({ type: 'Text' })).map((one: any) => String(one.props.children ?? one.text ?? ''))
    expect(seen.indexOf('别的插件')).toBe(0)
    expect(seen.includes('│')).toBe(false)
    expect((await ui.findAll({ type: 'Box' })).filter((one: any) => one.props?.borderStyle !== undefined).length).toBe(0)
    expect(await ui.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
    await ui.unmount()
  })
})
