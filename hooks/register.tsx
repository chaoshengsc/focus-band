import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Focus, RateLimit } from '../types'

// 平时不上色，只有接近上限时才用主题里的警告色和错误色。
// 桌面端的用量面板在 94% 时已经是红色（实测），所以 90 起用错误色；页脚圆环的 80 / 95 是另一套
// stroke 是桌面端小圆环的颜色：矢量图读不到主题，所以用深浅主题下都看得清的中间调
const LEVELS = [
  { upTo: 80, color: undefined, stroke: undefined },
  { upTo: 90, color: 'warning', stroke: '#d9822b' },
  { upTo: Infinity, color: 'error', stroke: '#d64545' },
]
const TRACK = 'rgba(128,128,128,0.25)'
const BAR = 72
// 配色：只换进度条平时的颜色。背景板是界面自己画的，mod 盖不满它，所以不碰底色
const TINTS = ['#6f6f6f', '#3a3a3a', '#8a7a63', '#d97757', '#4a6fd8', '#5b8a5a', '#7b61c9']
// 只画认识的窗口，其余不显示
const WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const TOOL = 'mcp__focus-band__set_focus'

type Lang = 'zh' | 'en'

// 界面文字：中文和英文各一套。配色名、版式名按序号对应 TINTS 和版式 1-3
const TEXT = {
  zh: {
    goal: '终点',
    bottleneck: '瓶颈',
    scope: '范围',
    styles: ['', '标准', '一行', '页脚'],
    tints: ['默认', '墨黑', '暖沙', '陶土', '雾蓝', '苔绿', '藤紫'],
    listed: '、',
    usage: '用法：/focus 终点 | 瓶颈 | 范围（用全角｜或两侧带空格的 | 分隔，范围可省略）；/focus clear 清除；/focus style、/focus color、/focus lang 改版式、配色、语言',
    tintUsage: (names: string) => `用法：/focus color 1-${TINTS.length}，或配色名（${names}）；不带参数则换下一个`,
    styleUsage: '用法：/focus style 1（标准）、2（一行）、3（页脚）；不带参数则轮换',
    langUsage: '用法：/focus lang zh 或 en；不带参数则切换',
    tool: '更新输入框上方常驻显示的“三行定位”。开始一项实质性工作前调用；终点、瓶颈或授权范围发生变化时再次调用。',
    toolGoal: '终点：这件事最终要达成什么（整件事，不是这一步）',
    toolBottleneck: '瓶颈：现在挡在终点前的唯一约束',
    toolScope: '授权范围：允许写入的文件、目录或 worktree',
    focusCommand: '查看或改写终点/瓶颈/授权范围；style、color、lang 改版式、配色、语言',
    focusHint: '终点 | 瓶颈 | 范围',
    noteSet: (told: string) =>
      `[focus-band] 输入框上方显示的当前定位——${told}。如果这条消息改变了终点、瓶颈或授权范围，先调用 set_focus 更新。`,
    noteUnset: '[focus-band] 尚未设置定位。如果这条消息开启一项实质性工作，先调用 set_focus 写明终点和瓶颈。',
    styleSet: (n: number, name: string) => `定位栏版式：${n} ${name}`,
    tintSet: (n: number, name: string) => `定位栏配色：${n} ${name}`,
    langSet: '定位栏语言：中文（命令说明下个会话生效）',
    deny: 'set_focus 需要非空的 goal 和 bottleneck。',
    updated: (told: string) => `已更新定位。${told}`,
    unset: (usage: string) => `尚未设定。${usage}`,
    cleared: '已清除定位。',
    both: (usage: string) => `终点和瓶颈都要填。${usage}`,
    tintAlt: (name: string) => `配色：${name}`,
    used: (figure: string) => `已用 ${figure}`,
    told: (one: Focus) => `终点：${one.goal}；瓶颈：${one.bottleneck}；范围：${one.scope || '未指定'}`,
  },
  en: {
    goal: 'Goal',
    bottleneck: 'Bottleneck',
    scope: 'Scope',
    styles: ['', 'standard', 'one line', 'footer'],
    tints: ['Default', 'Ink', 'Sand', 'Clay', 'Blue', 'Moss', 'Violet'],
    listed: ', ',
    usage: 'Usage: /focus goal | bottleneck | scope (separate with " | "; scope is optional); /focus clear removes it; /focus style, /focus color and /focus lang change layout, color and language',
    tintUsage: (names: string) => `Usage: /focus color 1-${TINTS.length}, or a color name (${names}); no argument picks the next one`,
    styleUsage: 'Usage: /focus style 1 (standard), 2 (one line), 3 (footer); no argument cycles',
    langUsage: 'Usage: /focus lang zh or en; no argument switches',
    tool: 'Update the focus shown above the prompt box. Call it before starting substantial work, and again whenever the goal, the bottleneck or the write scope changes.',
    toolGoal: 'Goal: what the whole task must achieve in the end (the task, not this step)',
    toolBottleneck: 'Bottleneck: the one constraint standing between now and the goal',
    toolScope: 'Scope: the files, directories or worktree that may be written',
    focusCommand: 'Show or set the goal / bottleneck / write scope; style, color, lang change the band',
    focusHint: 'goal | bottleneck | scope',
    noteSet: (told: string) =>
      `[focus-band] Current focus shown above the prompt box: ${told}. If this message changes the goal, the bottleneck or the write scope, call set_focus first.`,
    noteUnset:
      '[focus-band] No focus is set. If this message starts substantial work, call set_focus first with the goal and the bottleneck.',
    styleSet: (n: number, name: string) => `Band layout: ${n} ${name}`,
    tintSet: (n: number, name: string) => `Band color: ${n} ${name}`,
    langSet: 'Band language: English (command descriptions change next session)',
    deny: 'set_focus needs a non-empty goal and bottleneck.',
    updated: (told: string) => `Focus updated. ${told}`,
    unset: (usage: string) => `No focus set. ${usage}`,
    cleared: 'Focus cleared.',
    both: (usage: string) => `Both goal and bottleneck are required. ${usage}`,
    tintAlt: (name: string) => `Color: ${name}`,
    used: (figure: string) => `${figure} used`,
    told: (one: Focus) => `Goal: ${one.goal}; Bottleneck: ${one.bottleneck}; Scope: ${one.scope || 'not set'}`,
  },
}
const MAX_LENGTH = 200
const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000
// 每个会话存一条定位，只留最近的这么多条
const KEPT_SESSIONS = 50

const focus = atom({ plugin: 'focus-band', key: 'focus' } as const, null)
const limits = atom({ plugin: 'focus-band', key: 'limits' } as const, [])
const style = atom({ plugin: 'focus-band', key: 'style' } as const, 1)
const tint = atom({ plugin: 'focus-band', key: 'tint' } as const, 0)
const isReady = atom({ plugin: 'focus-band', key: 'isReady' } as const, false)
// 现在这条定位属于哪个会话：/clear 和恢复会话会换会话而不重新启动
const lang = atom({ plugin: 'focus-band', key: 'lang' } as const, 'zh')
const owner = atom({ plugin: 'focus-band', key: 'owner' } as const, '')

let tick: { cancel(): void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 先把上次存下的读回来，栏才能第一时间出现；读不到也不能耽误后面注册工具和命令
    try {
      const held = await kept($)
      await update($, style, () => held.style)
      await update($, tint, () => held.tint)
      await update($, lang, () => held.lang)
      // 猜出来的语言记下来，以后不再猜
      await $.store.set('lang', held.lang)
      await update($, focus, () => held.focus)
      await update($, owner, () => held.owner)
      await update($, limits, () => held.limits)
      await update($, isReady, () => true)
    } catch {
      // 留在未就绪状态，画的时候会再读一次存储
    }

    const result = await next(e)
    const t = await words($)
    await $.tool.register({
      name: 'set_focus',
      description: t.tool,
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: t.toolGoal },
          bottleneck: { type: 'string', description: t.toolBottleneck },
          scope: { type: 'string', description: t.toolScope },
        },
        required: ['goal', 'bottleneck'],
      },
    })
    await quietly(() => reread($))
    await quietly(() => prune($))
    // 重置时刻会过去：每分钟重画一次，过期的窗口才会及时变成“—”
    tick?.cancel()
    tick = $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
    // 只注册一条命令，版式、配色、语言都是它的子命令：桌面端只认到一个插件的第一条命令
    await $.command.register({ name: 'focus', description: t.focusCommand, argumentHint: t.focusHint })

    return result
  })

  // /clear 和恢复会话不会重新启动，只会走到这里：稍后重画一次，栏上换成新会话自己的定位
  on('session.end', async ($, e, next) => {
    const result = await next(e)

    try {
      $.clock.after(1000, () => $.ui.invalidate('ui.render'))
    } catch {
      // 真退出时定时器起不来也无妨
    }

    return result
  })

  // 让模型不用先搜索就能调用 set_focus
  on('tool.describe', { tool: TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  // 每条提示后面附一句当前定位，只有模型看得到：定位才不会停在上一件事上
  on('prompt.submit', async ($, e, next) => {
    let note = ''

    try {
      const seen = await adopt($)
      const t = TEXT[seen.lang]
      note = seen.focus ? t.noteSet(t.told(seen.focus)) : t.noteUnset
    } catch {
      // 读不到就不附
    }

    return next(note === '' ? e : { ...e, context: [...(e.context ?? []), note] })
  })

  // 额度变化由引擎推送：每个主对话回合之后，以及某个窗口移动一个整点时
  on('session.measure', async ($, e, next) => {
    // 空读数不清掉上一次的
    if (e.changed.includes('rateLimits') && (e.rateLimits ?? []).length > 0) {
      await quietly(() => storeLimits($, e.rateLimits))
    }

    return next(e)
  })

  // 回合中途每次工具调用后、回合结束时再主动读一次最近一次响应带回的读数；子代理的不算，出错也不影响调用本身
  on('tool.call', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await quietly(() => reread($))
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if ((e as { agentId?: string }).agentId === undefined) {
      await quietly(() => reread($))
    }

    return result
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const goal = clean(e.goal)
    const bottleneck = clean(e.bottleneck)
    const t = await words($)

    if (!goal || !bottleneck) {
      return { deny: t.deny }
    }

    const next: Focus = { goal, bottleneck, scope: clean(e.scope) }
    await setFocus($, next)

    return { result: t.updated(t.told(next)) }
  })

  on('command.run', { command: 'focus' }, async ($, e) => {
    const args = (e.args ?? '').trim()
    const t = await words($)

    if (args === '') {
      const current = (await adopt($)).focus

      return { text: current ? t.told(current) : t.unset(t.usage) }
    }

    // 子命令：style / color / lang，后面跟参数或留空
    const [head = '', ...tail] = args.split(/\s+/)
    const sub = /\s\|\s|｜/.test(args) ? '' : head.toLowerCase()
    const given = tail.join(' ')

    if (sub === 'style') {
      return runStyle($, given)
    }

    if (sub === 'color') {
      return runColor($, given)
    }

    if (sub === 'lang') {
      return runLang($, given)
    }

    if (args.toLowerCase() === 'clear' || args === '清除') {
      await setFocus($, null)

      return { text: t.cleared }
    }

    // 内容里的 || 或管道符不算分隔；第三段之后都并入范围
    const [first = '', second = '', ...rest] = args.split(/\s+\|\s+|\s*｜\s*/)
    const goal = clean(first)
    const bottleneck = clean(second)

    if (!goal || !bottleneck) {
      return { text: t.both(t.usage) }
    }

    const next: Focus = { goal, bottleneck, scope: clean(rest.join(' | ')) }
    await setFocus($, next)

    return { text: t.updated(t.told(next)) }
  })

  // 页脚右侧、模型名旁边的那一组弱化标签：版式 3 把额度放在这里
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const seen = await view($)
    const windows = known(seen.limits)

    if (seen.style !== 3 || windows.length === 0) {
      return next(e)
    }

    const table = $.ui.resolve(e) as any
    const { Box, Text } = table

    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')}</Text>}
        {meters(table, e.surface, windows, 'ring', TINTS[seen.tint] ?? TINTS[0], await $.clock.now(), false, TEXT[seen.lang])}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const seen = await view($)
    const current = seen.focus
    const windows = known(seen.limits)
    const asked = seen.style
    // 标准版有定位时要两行，放不下就退回一行
    const picked = asked === 1 && current !== null && windows.length > 0 && e.props.maxRows < 2 ? 2 : asked
    const hasQuota = windows.length > 0 && picked !== 3

    if (e.props.hasSurvey || (current === null && !hasQuota)) {
      return next(e)
    }

    const table = $.ui.resolve(e) as any
    const { Box, Text, Button } = table
    const columns = e.props.bodyColumns
    const accent = TINTS[seen.tint] ?? TINTS[0]
    const t = TEXT[seen.lang]
    const tintName = t.tints[seen.tint] ?? t.tints[0]
    const now = await $.clock.now()
    // 外框：右侧常驻换色按钮
    const framed = (body: unknown) => (
      <Box key="band" flexDirection="row" gap={1} alignItems="center">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          {body}
        </Box>
        <Box flexShrink={0}>
          {e.surface !== 'terminal' && table.Svg ? (
            // 按钮只收文字，图片又点不了：把小螃蟹画在下面，上面叠一个空标签的按钮接点击
            // 按钮的 key 跟着配色变：点完后旧按钮消失，界面不会把焦点框留在螃蟹上
            // 按钮宽不过图片，所以图片两侧各留一格透明边，按钮框才围得住螃蟹；叠放层铺满并居中
            // 右边再留一格，免得框被内容区的边界裁掉
            <Box alignItems="center" marginRight={1}>
              <table.Svg source={CRAB} alt={t.tintAlt(tintName)} width={28} height={16} />
              <Box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center">
                <Button key={`tint${seen.tint}`} label={'\u2003\u2005'} plain onPress={() => void quietly(() => nextTint($))} />
              </Box>
            </Box>
          ) : (
            <Button key="tint" label={tintName} plain dimColor onPress={() => void quietly(() => nextTint($))} />
          )}
        </Box>
      </Box>
    )

    // 1 标准：带标签的定位一行；额度一行，细进度条加重置时间
    if (picked === 1) {
      const dot = <Text dimColor>·</Text>
      const item = (name: string, value: string) => (
        <Text wrap="truncate-end">
          <Text dimColor>{name} </Text>
          {value}
        </Text>
      )

      return framed(
        // 每一层都要允许收缩到 0，长文字才会被截成省略号，而不是把整行撑出底板、把螃蟹挤走
        <Box flexDirection="column" minWidth={0}>
          {current !== null && (
            <Box flexDirection="row" gap={1} minWidth={0}>
              {item(t.goal, current.goal)}
              {dot}
              {item(t.bottleneck, current.bottleneck)}
              {current.scope !== '' && dot}
              {current.scope !== '' && item(t.scope, current.scope)}
            </Box>
          )}
          {hasQuota && (
            <Box flexDirection="row" gap={1} alignItems="center">
              {meters(table, e.surface, windows, columns >= 36 ? 'bar' : 'none', accent, now, columns >= 50, t, dot)}
            </Box>
          )}
        </Box>,
      )
    }

    // 2 一行 / 3 页脚：一句安静的话，终点弱化在前，瓶颈在后；版式 2 把额度靠右放
    return framed(
      <Box flexDirection="row" gap={2} alignItems="center" minWidth={0}>
        {current !== null && (
          <Text wrap="truncate-end">
            {columns >= 60 && <Text dimColor>{current.goal} › </Text>}
            {current.bottleneck}
          </Text>
        )}
        <Box flexGrow={1} />
        {hasQuota && meters(table, e.surface, windows, 'ring', accent, now, false, t)}
      </Box>,
    )
  })
}

// /focus 的三个子命令：版式、配色、语言
async function runStyle($: EngineInterface, args: string) {
  const t = await words($)

  if (args !== '' && !/^[123]$/.test(args)) {
    return { text: t.styleUsage }
  }

  const current = await read($, style)
  const picked = args === '' ? (current % 3) + 1 : Number(args)
  await update($, style, () => picked)
  await $.store.set('style', picked)

  return { text: t.styleSet(picked, t.styles[picked]) }
}

async function runColor($: EngineInterface, args: string) {
  const t = await words($)
  // 配色名两种语言都认
  const named = (names: string[]) => names.findIndex(name => name.toLowerCase() === args.toLowerCase())
  const byName = Math.max(named(TEXT.zh.tints), named(TEXT.en.tints))
  const byNumber = /^\d+$/.test(args) ? Number(args) - 1 : -1
  const asked = byName >= 0 ? byName : byNumber

  if (args !== '' && TINTS[asked] === undefined) {
    return { text: t.tintUsage(t.tints.join(t.listed)) }
  }

  const picked = args === '' ? await nextTint($) : await setTint($, asked)

  return { text: t.tintSet(picked + 1, t.tints[picked]) }
}

async function runLang($: EngineInterface, asked: string) {
  const args = asked.toLowerCase()

  if (args !== '' && args !== 'zh' && args !== 'en') {
    return { text: (await words($)).langUsage }
  }

  const picked: Lang = args === '' ? ((await read($, lang)) === 'zh' ? 'en' : 'zh') : args
  await update($, lang, () => picked)
  await $.store.set('lang', picked)

  return { text: TEXT[picked].langSet }
}

// 每个窗口：标签、指示（细条或小圆环，终端上细条退回字符）、百分比，需要时再加重置时间
function meters(
  table: any,
  surface: string,
  windows: RateLimit[],
  shape: 'bar' | 'ring' | 'none',
  accent: string,
  now: number,
  hasTime: boolean,
  t: (typeof TEXT)[Lang],
  separator?: unknown,
) {
  const { Box, Text } = table
  const Svg = surface === 'terminal' ? undefined : table.Svg

  return windows.map((one, i) => {
    // 重置时刻已过：这个读数是上个窗口的，不再当真，画成空的
    const isStale = one.resetsAt !== undefined && new Date(one.resetsAt).getTime() <= now
    const used = isStale ? 0 : Math.min(100, Math.max(0, one.percentUsed))
    const level = LEVELS.find(step => used < step.upTo) ?? LEVELS[0]
    const color = level.color
    // 只有进度条变色，数字保持正文色；平时用所选配色，接近上限时警告色优先
    const stroke = level.stroke ?? accent
    const when = hasTime && one.resetsAt ? resets(one.resetsAt, now) : ''
    const filled = Math.round(used / 10)
    const figure = isStale ? '—' : one.percentUsed > 100 ? '100%+' : `${used}%`

    return (
      <Box key={one.kind} flexDirection="row" gap={1} flexShrink={0} alignItems="center">
        {i > 0 && separator}
        <Text dimColor>{WINDOWS[one.kind]}</Text>
        {shape === 'ring' && Svg && <Svg source={ring(used, stroke)} alt={t.used(figure)} width={14} height={14} />}
        {shape === 'bar' && Svg && <Svg source={bar(used, stroke)} alt={t.used(figure)} width={BAR} height={6} />}
        {shape === 'bar' && !Svg && (
          <Text>
            {filled > 0 && <Text color={color}>{'█'.repeat(filled)}</Text>}
            {filled < 10 && <Text color="inactive">{'░'.repeat(10 - filled)}</Text>}
          </Text>
        )}
        <Text dimColor={isStale}>{figure}</Text>
        {when !== '' && <Text dimColor>{when}</Text>}
      </Box>
    )
  })
}

// Claude Code 的小螃蟹：照桌面端新会话里输入框上那只画的 12×8 像素格，左右各留一格透明边。
// 显示成 28×16，每格正好 2 像素，普通屏和高分屏都不发虚
const CRAB =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 8" shape-rendering="crispEdges"><g fill="#c36e51"><rect x="3" y="0" width="8" height="6"/><rect x="1" y="2" width="12" height="2"/><rect x="3" y="6" width="1" height="2"/><rect x="5" y="6" width="1" height="2"/><rect x="8" y="6" width="1" height="2"/><rect x="10" y="6" width="1" height="2"/></g><rect x="4" y="1" width="1" height="1"/><rect x="9" y="1" width="1" height="1"/></svg>'

// 4 像素高的圆角细线，代替比例字体下难看的方块字符
function bar(used: number, fill: string): string {
  const filled = used <= 0 ? 0 : Math.max(4, (used / 100) * BAR)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR}" height="6" viewBox="0 0 ${BAR} 6">` +
    `<rect x="0" y="1" width="${BAR}" height="4" rx="2" fill="${TRACK}"/>` +
    (filled > 0 ? `<rect x="0" y="1" width="${filled.toFixed(1)}" height="4" rx="2" fill="${fill}"/>` : '') +
    `</svg>`
  )
}

// 和页脚右下角原生指示器同一种形状：细圆环，从正上方顺时针填充
function ring(used: number, stroke: string): string {
  const around = 2 * Math.PI * 5
  const arc = (used / 100) * around

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">` +
    `<circle cx="7" cy="7" r="5" fill="none" stroke="${TRACK}" stroke-width="2"/>` +
    (used > 0
      ? `<circle cx="7" cy="7" r="5" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" ` +
        `stroke-dasharray="${arc.toFixed(2)} ${around.toFixed(2)}" transform="rotate(-90 7 7)"/>`
      : '') +
    `</svg>`
  )
}

type View = { style: number; tint: number; lang: Lang; focus: Focus | null; owner: string; limits: RateLimit[] }

// 上次存下的版式、配色、本会话的定位和额度
async function kept($: EngineInterface): Promise<View> {
  const [keptStyle, keptTint, keptLimits] = [await $.store.get('style'), await $.store.get('tint'), await $.store.get('limits')]
  const keptLang = await $.store.get('lang')
  let keptFocus: Focus | null = null
  let session = ''

  try {
    session = await $.session.id()
    keptFocus = asFocus(await $.store.get(`focus:${session}`))
  } catch {
    // 会话还没绑定时拿不到会话标识，定位先不显示
  }

  return {
    style: keptStyle === 1 || keptStyle === 2 || keptStyle === 3 ? keptStyle : 1,
    tint: typeof keptTint === 'number' && TINTS[keptTint] !== undefined ? keptTint : 0,
    lang: keptLang === 'zh' || keptLang === 'en' ? keptLang : await guess($),
    focus: keptFocus,
    owner: session,
    limits: Array.isArray(keptLimits) ? keptLimits.filter(isLimit) : [],
  }
}

// 画的时候用的数据：会话就绪前直接读存储，免得等到第一条消息之后才出现
async function view($: EngineInterface): Promise<View> {
  if (!(await read($, isReady))) {
    try {
      return await kept($)
    } catch {
      // 存储也读不到就按空的画
    }
  }

  const seen: View = {
    style: await read($, style),
    tint: await read($, tint),
    lang: await read($, lang),
    focus: await read($, focus),
    owner: await read($, owner),
    limits: await read($, limits),
  }

  // /clear 或恢复会话之后会话换了：画新会话自己的定位，不把上一个会话的挂在上面。
  // 画的时候不能写状态，所以这里只读存储；状态由 adopt 在下一条提示时跟上
  try {
    const session = await $.session.id()

    if (session !== seen.owner) {
      return { ...seen, owner: session, focus: asFocus(await $.store.get(`focus:${session}`)) }
    }
  } catch {
    // 拿不到会话标识就照现有的画
  }

  return seen
}

// 会话换了之后，把状态里的定位也换成新会话的
async function adopt($: EngineInterface) {
  const seen = await view($)

  if (seen.owner !== (await read($, owner))) {
    await update($, focus, () => seen.focus)
    await update($, owner, () => seen.owner)
  }

  return seen
}

const words = async ($: EngineInterface) => TEXT[(await view($)).lang]

// 没选过语言时：系统是中文、或以前写过的定位里有中文，就用中文；否则英文
async function guess($: EngineInterface): Promise<Lang> {
  try {
    if (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale)) {
      return 'zh'
    }
  } catch {
    // 没有就只看定位
  }

  try {
    for (const key of (await $.store.keys()).filter(key => key.startsWith('focus:'))) {
      const held = asFocus(await $.store.get(key))

      if (/[\u4e00-\u9fff]/.test(`${held?.goal ?? ''}${held?.bottleneck ?? ''}`)) {
        return 'zh'
      }
    }
  } catch {
    // 读不到就按英文
  }

  return 'en'
}

// 界面事件里出的错不该冒到引擎去
async function quietly(work: () => Promise<unknown>) {
  try {
    await work()
  } catch {
    // 下一次读数或下一次点击再来
  }
}

// 定位按会话存，只留最近写过的 KEPT_SESSIONS 条
async function prune($: EngineInterface) {
  const keys = (await $.store.keys()).filter(key => key.startsWith('focus:'))

  if (keys.length <= KEPT_SESSIONS) {
    return
  }

  const aged = await Promise.all(
    keys.map(async key => ({ key, at: Number((await $.store.get(key) as { at?: number } | null)?.at) || 0 })),
  )

  for (const one of aged.sort((a, b) => b.at - a.at).slice(KEPT_SESSIONS)) {
    await $.store.delete(one.key)
  }
}

async function setTint($: EngineInterface, picked: number) {
  await update($, tint, () => picked)
  await $.store.set('tint', picked)

  return picked
}

async function nextTint($: EngineInterface) {
  return setTint($, ((await read($, tint)) + 1) % TINTS.length)
}

const known = (windows: RateLimit[]) => windows.filter(one => WINDOWS[one.kind] !== undefined)

async function setFocus($: EngineInterface, next: Focus | null) {
  const session = await $.session.id()
  await update($, focus, () => next)
  await update($, owner, () => session)

  if (next === null) {
    await $.store.delete(`focus:${session}`)
  } else {
    await $.store.set(`focus:${session}`, { ...next, at: await $.clock.now() })
  }
}

function asFocus(value: unknown): Focus | null {
  const one = value as Partial<Focus> | null
  const goal = clean(one?.goal)
  const bottleneck = clean(one?.bottleneck)

  return goal && bottleneck ? { goal, bottleneck, scope: clean(one?.scope) } : null
}

function isLimit(value: unknown): value is RateLimit {
  const one = value as Partial<RateLimit> | null

  return typeof one?.kind === 'string' && typeof one?.percentUsed === 'number'
}

// 没有读数时保留上一次的，不清空
async function reread($: EngineInterface) {
  const { rateLimits } = await $.session.usage()

  if (rateLimits.length > 0) {
    await storeLimits($, rateLimits)
  }
}

async function storeLimits($: EngineInterface, rateLimits: readonly RateLimit[] | undefined) {
  // 显示是整数，存整数，小数变动不必重画
  const fresh: RateLimit[] = (rateLimits ?? []).filter(isLimit).map(one => ({
    kind: clean(one.kind),
    percentUsed: Math.round(one.percentUsed),
    ...(one.resetsAt ? { resetsAt: one.resetsAt } : {}),
  }))
  const held = await read($, limits)

  if (JSON.stringify(held) !== JSON.stringify(fresh)) {
    await update($, limits, () => fresh)
    await $.store.set('limits', fresh)
  }
}

// 24 小时内显示时刻，更远显示月日；无法解析或已经过去则不显示（过去的由 meters 画成“—”）
function resets(iso: string, now: number): string {
  const at = new Date(iso)
  const ahead = at.getTime() - now

  if (Number.isNaN(ahead) || ahead <= 0) {
    return ''
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  return ahead < DAY ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : `${at.getMonth() + 1}/${at.getDate()}`
}

// 引擎拒绝绘制带控制字符的文字，所以先剔除
function clean(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LENGTH)
}
