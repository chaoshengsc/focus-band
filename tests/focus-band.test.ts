import { describe, expect, mock, test } from 'claude-code/testing'

const HOUR = 60 * 60 * 1000
const pad = (n: number) => String(n).padStart(2, '0')

function world(on: any, store: Record<string, unknown> = {}, limits: any[] = []) {
  const clock = mock.clock(on)
  // 可以中途改的会话标识和读数
  const live = { session: 's1', limits }
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
  on('session.id', () => ({ value: live.session }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: live.limits, context: { tokens: 0, window: 200_000, percent: 0 } },
  }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__focus-band__${e.name}` } }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', ($: any, e: any) => ({ turnId: e.turnId }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))

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

const setFocus = ($: any, input: Record<string, unknown>) =>
  $.tool.call({ tool: 'mcp__focus-band__set_focus', ...input })

const style = ($: any, args?: string) => $.command.run({ command: 'focus-style', args })

describe('focus-band', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`一行版：瓶颈在左，额度在右 (${surface})`, async ($: any, on: any) => {
      world(on, { style: 2 })
      await start($, surface)

      const set = await setFocus($, { goal: '提交可复现的结果', bottleneck: '验证脚本未跑通', scope: 'worktree/a' })
      expect(String(set.result)).toMatch(/已更新定位/)
      expect((await setFocus($, { goal: 'x', bottleneck: ' ' })).deny).toBeDefined()

      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /验证脚本未跑通/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /提交可复现的结果 ›/ })).toBeDefined()
      // 一行版不带标签、不带分隔点、不带范围
      expect(await ui.find({ type: 'Text', text: /瓶颈 |终点 |·|worktree/ })).toBeUndefined()

      expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
      await measure($, [
        { kind: 'five_hour', percentUsed: 23.5 },
        { kind: 'seven_day', percentUsed: 81 },
        { kind: 'seven_day_opus', percentUsed: 5 },
      ])
      expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^24%$/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^81%$/ }))?.props?.color).toBe('warning')
      expect(await ui.find({ type: 'Text', text: /opus/ })).toBeUndefined()
      // 任何界面都不再画方块字符；圆环只在桌面端
      expect(await ui.find({ type: 'Text', text: /█|░/ })).toBeUndefined()
      expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(surface === 'desktop')

      await ui.unmount()
    })
  }

  test('页脚版：额度画在模型名旁边，上方只留定位', async ($: any, on: any) => {
    const { kept } = world(on)
    await start($)
    await measure($, [{ kind: 'five_hour', percentUsed: 40 }])
    await setFocus($, { goal: '甲', bottleneck: '乙' })
    expect((await style($, '3')).text).toMatch(/3 页脚/)
    expect(kept.style).toBe(3)

    const footer = await mount($, 'desktop', {}, 'SessionMode')
    expect(await footer.find({ type: 'Text', text: /^40%$/ })).toBeDefined()
    expect(await footer.find({ type: 'Svg' })).toBeDefined()
    // 引擎原有的模式标签保留
    expect(await footer.find({ type: 'Text', text: /^focus$/ })).toBeDefined()
    await footer.unmount()

    const band = await mount($, 'desktop')
    expect(await band.find({ type: 'Text', text: /乙/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^40%$/ })).toBeUndefined()
    await band.unmount()

    expect((await style($, '4')).text).toMatch(/用法/)
    expect((await style($, 'abc')).text).toMatch(/用法/)
    expect((await style($)).text).toMatch(/1 标准/)
  })

  test('标准版：带标签、细进度条和重置时间，放不下退回一行', async ($: any, on: any) => {
    const { clock } = world(on)
    await start($)
    await setFocus($, { goal: '终点甲', bottleneck: '瓶颈乙', scope: '范围丙' })
    const now = clock.now()
    const soon = new Date(now + 3 * HOUR)
    const later = new Date(now + 100 * HOUR)
    await measure($, [
      { kind: 'five_hour', percentUsed: 96, resetsAt: soon.toISOString() },
      { kind: 'seven_day', percentUsed: 10, resetsAt: later.toISOString() },
      { kind: 'spend_limit', percentUsed: 150, resetsAt: 'not a date' },
    ])

    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^终点 $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /范围丙/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█|░/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^96%$/ }))?.props?.color).toBe('error')
    expect(await ui.find({ type: 'Text', text: /^100%\+$/ })).toBeDefined()
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
    expect(await term.find({ type: 'Text', text: /^█{10}$/ })).toBeDefined()
    expect(await term.find({ type: 'Svg' })).toBeUndefined()
    await term.unmount()

    // 只有一行高：退回一行版，没有标签
    const short = await mount($, 'desktop', { maxRows: 1 })
    expect(await short.find({ type: 'Text', text: /瓶颈乙/ })).toBeDefined()
    expect(await short.find({ type: 'Text', text: /^终点 $/ })).toBeUndefined()
    await short.unmount()
  })

  test('同一个会话重启后，定位和上次的额度都还在', async ($: any, on: any) => {
    world(on, {
      'focus:s1': { goal: '旧终点', bottleneck: '旧瓶颈', scope: '' },
      'focus:other': { goal: '别的会话', bottleneck: '不该出现', scope: '' },
      limits: [{ kind: 'five_hour', percentUsed: 37 }],
    })
    await start($)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /旧瓶颈/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /不该出现/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^37%$/ })).toBeDefined()
    await ui.unmount()
  })

  test('配色：只换进度条颜色；命令和螃蟹按钮都能换', async ($: any, on: any) => {
    const { kept } = world(on, {}, [{ kind: 'five_hour', percentUsed: 40 }])
    await start($)
    const color = async (args?: string) => (await $.command.run({ command: 'focus-color', args })).text as string
    const ui = await mount($, 'desktop')
    const fill = async () => String((await ui.find({ type: 'Svg' }))?.props?.source)

    expect(await fill()).toMatch(/#6f6f6f/)
    expect(await color('陶土')).toMatch(/4 陶土/)
    expect(await fill()).toMatch(/#d97757/)
    expect(kept.tint).toBe(3)
    expect(await color('5')).toMatch(/5 雾蓝/)
    expect(await color()).toMatch(/6 苔绿/)
    expect(await color('99')).toMatch(/用法/)
    expect(await color('粉')).toMatch(/用法/)

    // 螃蟹上叠的按钮：按一下换到下一个，按钮的 key 跟着配色走
    await ui.press({ key: 'tint5' })
    expect(await fill()).toMatch(/#7b61c9/)
    expect(kept.tint).toBe(6)
    await ui.press({ key: 'tint6' })
    expect(await fill()).toMatch(/#6f6f6f/)

    // 接近上限时警告色优先于配色
    await color('雾蓝')
    await measure($, [{ kind: 'five_hour', percentUsed: 80 }])
    expect(await fill()).toMatch(/#d9822b/)
    await ui.unmount()
  })

  test('会话还没就绪时就能画出上次存下的内容', async ($: any, on: any) => {
    world(on, {
      style: 1,
      tint: 4,
      'focus:s1': { goal: '旧终点', bottleneck: '旧瓶颈', scope: '' },
      limits: [{ kind: 'five_hour', percentUsed: 41 }],
    })
    // 故意不调用 session.start
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^41%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /旧瓶颈/ })).toBeDefined()
    expect(String((await ui.find({ type: 'Svg' }))?.props?.source)).toMatch(/#4a6fd8/)
    await ui.unmount()
  })

  test('控制字符被剔除，栏照常画出', async ($: any, on: any) => {
    world(on)
    await start($)
    await setFocus($, { goal: '终\u0007点', bottleneck: 'x\u001b[31mred' })
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /x \[31mred/ })).toBeDefined()
    await ui.unmount()
  })

  test('窗口已重置或读数为空：不把旧数字当真，也不清空', async ($: any, on: any) => {
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

    // 过了重置时刻：5h 画成“—”，不再带警告色；7d 不受影响
    await clock.advance(2 * HOUR)
    const later = await mount($, 'desktop')
    expect(await later.find({ type: 'Text', text: /^93%$/ })).toBeUndefined()
    expect((await later.find({ type: 'Text', text: /^—$/ }))?.props?.color).toBeUndefined()
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

  test('换了会话：栏上换成新会话自己的定位，各存各的', async ($: any, on: any) => {
    const { kept, live } = world(on, { 'focus:s2': { goal: '乙终点', bottleneck: '乙瓶颈', scope: '' } })
    await start($)
    await setFocus($, { goal: '甲终点', bottleneck: '甲瓶颈' })
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /甲瓶颈/ })).toBeDefined()
    await ui.unmount()

    // /clear 或恢复会话：会话标识变了，但不会重新启动
    live.session = 's2'
    const next = await mount($, 'desktop', { bodyColumns: 119 })
    expect(await next.find({ type: 'Text', text: /甲瓶颈/ })).toBeUndefined()
    expect(await next.find({ type: 'Text', text: /乙瓶颈/ })).toBeDefined()
    await next.unmount()

    await $.command.run({ command: 'focus', args: 'clear' })
    expect(kept['focus:s2']).toBeUndefined()
    expect((kept['focus:s1'] as any).bottleneck).toBe('甲瓶颈')
  })

  test('每条提示附上当前定位；旧会话的定位只留最近 50 条', async ($: any, on: any) => {
    const old = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`focus:old${i}`, { goal: 'g', bottleneck: 'b', scope: '', at: i }]),
    )
    const { kept } = world(on, old)
    await start($)
    expect(Object.keys(kept).filter(key => key.startsWith('focus:')).length).toBe(50)
    expect(kept['focus:old0']).toBeUndefined()
    expect(kept['focus:old59']).toBeDefined()

    const submit = async () => (await $.prompt.submit({ text: '你好', context: ['别人的'] })).context as string[]
    expect((await submit())[0]).toBe('别人的')
    expect((await submit())[1]).toMatch(/尚未设置定位/)
    await setFocus($, { goal: '终点甲', bottleneck: '瓶颈乙' })
    expect((await submit())[1]).toMatch(/终点：终点甲；瓶颈：瓶颈乙/)
  })

  test('终端：文字按钮换配色', async ($: any, on: any) => {
    const { kept } = world(on, {}, [{ kind: 'five_hour', percentUsed: 40 }])
    await start($, 'terminal')
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.press({ key: 'tint' })
    expect(kept.tint).toBe(1)
    await ui.unmount()
  })

  test('英文界面：标签、命令回复、给模型的那句话都是英文；可切换；没选过时按已有定位猜', async ($: any, on: any) => {
    const { kept } = world(on, { lang: 'en' }, [{ kind: 'five_hour', percentUsed: 40 }])
    await start($)
    expect(String((await setFocus($, { goal: 'ship it', bottleneck: 'tests' })).result)).toMatch(/Focus updated\. Goal: ship it/)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^Goal $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /终点|瓶颈/ })).toBeUndefined()
    await ui.unmount()
    expect((await $.command.run({ command: 'focus-color', args: 'clay' })).text).toMatch(/4 Clay/)
    expect((await $.command.run({ command: 'focus-color', args: '雾蓝' })).text).toMatch(/5 Blue/)
    expect(((await $.prompt.submit({ text: 'hi' })).context as string[])[0]).toMatch(/Current focus/)

    const lang = async (args?: string) => (await $.command.run({ command: 'focus-lang', args })).text as string
    expect(await lang('fr')).toMatch(/Usage/)
    expect(await lang()).toMatch(/中文/)
    expect(kept.lang).toBe('zh')
    const zh = await mount($, 'desktop')
    expect(await zh.find({ type: 'Text', text: /^终点 $/ })).toBeDefined()
    await zh.unmount()
  })

  test('没选过语言：以前的定位里有中文就用中文，并记下来', async ($: any, on: any) => {
    const { kept } = world(on, { lang: undefined, 'focus:old': { goal: '旧终点', bottleneck: '旧瓶颈', scope: '' } })
    await start($)
    expect(kept.lang).toBe('zh')
  })

  test('/focus 的解析与存储', async ($: any, on: any) => {
    const { kept } = world(on)
    await start($)
    const run = async (args?: string) => (await $.command.run({ command: 'focus', args })).text as string

    expect(await run()).toMatch(/尚未设定/)
    // 内容里的 || 不算分隔
    expect(await run('修 a||b 的 bug | 瓶颈')).toMatch(/终点：修 a\|\|b 的 bug；瓶颈：瓶颈；范围：未指定/)
    // 全角分隔，第三段之后并入范围
    expect(await run('甲 ｜ 乙 ｜ 丙 | 丁')).toMatch(/终点：甲；瓶颈：乙；范围：丙 \| 丁/)
    expect((kept['focus:s1'] as any).bottleneck).toBe('乙')
    expect(await run('只有终点')).toMatch(/终点和瓶颈都要填/)
    expect(await run()).toMatch(/终点：甲/)
    expect(await run('CLEAR')).toMatch(/已清除/)
    expect(kept['focus:s1']).toBeUndefined()
    expect(await run()).toMatch(/尚未设定/)
  })
})
