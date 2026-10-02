import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RateLimit } from '../types'

// 进度条平时用所选配色，接近上限时换成警告色、错误色；数字始终是正文色。
// 桌面端的用量面板在 94% 时已经是红色（实测），所以 90 起用错误色；页脚圆环的 80 / 95 是另一套。
// stroke 是矢量图里的颜色：矢量图读不到主题，所以用深浅主题下都看得清的中间调
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
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const MAX_LENGTH = 200

type Lang = 'zh' | 'en'

// 界面文字：中文和英文各一套。配色名、位置名按序号对应 TINTS 和位置 1-2
const TEXT = {
  zh: {
    styles: ['', '输入框上方', '页脚'],
    tints: ['默认', '墨黑', '暖沙', '陶土', '雾蓝', '苔绿', '藤紫'],
    listed: '、',
    command: '额度栏：color 换配色 / style 换位置 / lang 换语言',
    hint: 'color | style | lang',
    usage: '用法：/band color [1-7 或配色名]、/band style [1 输入框上方 | 2 页脚]、/band lang [zh | en]；不带值则换下一个',
    tintUsage: (names: string) => `用法：/band color 1-${TINTS.length}，或配色名（${names}）；不带参数则换下一个`,
    styleUsage: '用法：/band style 1（输入框上方）或 2（页脚）；不带参数则切换',
    langUsage: '用法：/band lang zh 或 en；不带参数则切换',
    styleSet: (n: number, name: string) => `额度栏位置：${n} ${name}`,
    tintSet: (n: number, name: string) => `额度栏配色：${n} ${name}`,
    langSet: '额度栏语言：中文（命令说明下个会话生效）',
    tintAlt: (name: string) => `配色：${name}`,
    used: (figure: string) => `已用 ${figure}`,
  },
  en: {
    styles: ['', 'above the prompt', 'footer'],
    tints: ['Default', 'Ink', 'Sand', 'Clay', 'Blue', 'Moss', 'Violet'],
    listed: ', ',
    command: 'Usage band: color / style (where it sits) / lang',
    hint: 'color | style | lang',
    usage: 'Usage: /band color [1-7 or a name], /band style [1 above the prompt | 2 footer], /band lang [zh | en]; no value picks the next one',
    tintUsage: (names: string) => `Usage: /band color 1-${TINTS.length}, or a color name (${names}); no argument picks the next one`,
    styleUsage: 'Usage: /band style 1 (above the prompt) or 2 (footer); no argument switches',
    langUsage: 'Usage: /band lang zh or en; no argument switches',
    styleSet: (n: number, name: string) => `Band position: ${n} ${name}`,
    tintSet: (n: number, name: string) => `Band color: ${n} ${name}`,
    langSet: 'Band language: English (the command description changes next session)',
    tintAlt: (name: string) => `Color: ${name}`,
    used: (figure: string) => `${figure} used`,
  },
}

const limits = atom({ plugin: 'focus-band', key: 'limits' } as const, [])
const style = atom({ plugin: 'focus-band', key: 'style' } as const, 1)
const tint = atom({ plugin: 'focus-band', key: 'tint' } as const, 0)
const lang = atom({ plugin: 'focus-band', key: 'lang' } as const, 'zh')
const isReady = atom({ plugin: 'focus-band', key: 'isReady' } as const, false)

let tick: { cancel(): void } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 先把上次存下的读回来，栏才能第一时间出现；读不到也不能耽误后面
    try {
      const held = await kept($)
      await update($, style, () => held.style)
      await update($, tint, () => held.tint)
      await update($, lang, () => held.lang)
      // 猜出来的语言记下来，以后不再猜
      await $.store.set('lang', held.lang)
      await update($, limits, () => held.limits)
      await update($, isReady, () => true)
    } catch {
      // 留在未就绪状态，画的时候会再读一次存储
    }

    const result = await next(e)
    await quietly(() => reread($))
    await quietly(() => forget($))
    // 重置时刻会过去：每分钟重画一次，过期的窗口才会及时变成“—”
    tick?.cancel()
    tick = $.clock.every(MINUTE, () => $.ui.invalidate('ui.render'))
    // 只注册一条命令：桌面端只认到一个插件的第一条命令
    const t = await words($)
    await $.command.register({ name: 'band', description: t.command, argumentHint: t.hint })

    return result
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

  on('command.run', { command: 'band' }, async ($, e) => {
    const [head = '', ...tail] = (e.args ?? '').trim().split(/\s+/)
    const sub = head.toLowerCase()
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

    return { text: (await words($)).usage }
  })

  // 页脚右侧、模型名旁边的那一组弱化标签：位置 2 把额度放在这里
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const seen = await view($)
    const windows = known(seen.limits)

    if (seen.style !== 2 || windows.length === 0) {
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
    const windows = known(seen.limits)

    if (e.props.hasSurvey || seen.style !== 1 || windows.length === 0) {
      return next(e)
    }

    const table = $.ui.resolve(e) as any
    const { Box, Text, Button } = table
    const columns = e.props.bodyColumns
    const t = TEXT[seen.lang]
    const tintName = t.tints[seen.tint] ?? t.tints[0]

    return (
      <Box key="band" flexDirection="row" gap={1} alignItems="center">
        <Box flexDirection="row" gap={1} alignItems="center" flexGrow={1} flexShrink={1} minWidth={0}>
          {meters(
            table,
            e.surface,
            windows,
            columns >= 36 ? 'bar' : 'none',
            TINTS[seen.tint] ?? TINTS[0],
            await $.clock.now(),
            columns >= 50,
            t,
            <Text dimColor>·</Text>,
          )}
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
  })
}

// /band 的三个子命令：位置、配色、语言
async function runStyle($: EngineInterface, args: string) {
  const t = await words($)

  if (args !== '' && !/^[12]$/.test(args)) {
    return { text: t.styleUsage }
  }

  const picked = args === '' ? ((await read($, style)) === 1 ? 2 : 1) : Number(args)
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

type View = { style: number; tint: number; lang: Lang; limits: RateLimit[] }

// 上次存下的位置、配色、语言和额度
async function kept($: EngineInterface): Promise<View> {
  const [keptStyle, keptTint, keptLang, keptLimits] = [
    await $.store.get('style'),
    await $.store.get('tint'),
    await $.store.get('lang'),
    await $.store.get('limits'),
  ]

  return {
    style: keptStyle === 1 || keptStyle === 2 ? keptStyle : 1,
    tint: typeof keptTint === 'number' && TINTS[keptTint] !== undefined ? keptTint : 0,
    lang: keptLang === 'zh' || keptLang === 'en' ? keptLang : guess(),
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

  return { style: await read($, style), tint: await read($, tint), lang: await read($, lang), limits: await read($, limits) }
}

const words = async ($: EngineInterface) => TEXT[(await view($)).lang]

// 没选过语言时：系统是中文就用中文，否则英文
function guess(): Lang {
  try {
    return /^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

// 0.16 之前按会话存过“定位”，现在不用了，清掉
async function forget($: EngineInterface) {
  for (const key of (await $.store.keys()).filter(key => key.startsWith('focus:'))) {
    await $.store.delete(key)
  }
}

// 界面事件里出的错不该冒到引擎去
async function quietly(work: () => Promise<unknown>) {
  try {
    await work()
  } catch {
    // 下一次读数或下一次点击再来
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
