# focus-band

[English](README.md) | 中文

一个 Claude Code mod：在桌面端输入框上方常驻显示额度用量——5h 和 7d 两个窗口，各带一条细进度条、百分比和重置时间。

![效果截图](docs/screenshot.zh.png)

状态：0.16.0。`claude plugin validate` 通过，`claude plugin test` 6 通过。

进度条 80% 起变橙、90% 起变红，数字始终是正文色。窗口过了重置时刻后显示 `—`，直到拿到新的读数。

早期版本在进度条上方还有一行“终点 / 瓶颈 / 范围”（截图里还能看到）。0.16.0 把它删掉了：它要靠模型持续更新，实际用下来经常过期。

## 安装

需要支持 mods 的 Claude Code（2.1.286 及以上）。在终端里运行这一条，然后新开一个会话：

```bash
claude plugin marketplace add chaoshengsc/focus-band && claude plugin install focus-band@chaoshengsc
```

更新用 `claude plugin marketplace update chaoshengsc`，卸载用 `claude plugin uninstall focus-band@chaoshengsc`。

目录结构：`.claude-plugin/plugin.json`（清单）、`hooks/register.tsx`（全部逻辑）、`types/index.d.ts`（状态声明）、`tests/`（测试）。

## 用法

只有一条命令，三个子命令；不带值则换下一个：

- `/band color [1-7 | 配色名]`：进度条配色（桌面端点右侧小螃蟹也行）
- `/band style [1 | 2]`：位置，1 输入框上方，2 页脚模型名旁边
- `/band lang [zh | en]`：命令回复的语言；系统是中文时默认中文，否则英文

## 已知限制（机制所限，不是待办）

- 灰色底板是桌面端画的，mod 改不了它的颜色、圆角、高度
- 额度来自“最近一次模型响应”，会话空闲或别的会话在消耗时会滞后于用量面板
- 一行约 19px 高，图标超过就会撑高底板；按钮焦点框上下会被裁
- 桌面端只认到一个 mod 注册的第一条斜杠命令，所以全部功能都放在 `/band` 下

## 改动后

```bash
claude plugin validate ~/.claude/skills/focus-band
```

```bash
claude plugin test ~/.claude/skills/focus-band
```

改完要重启会话才生效。

## 许可证

MIT，见 [LICENSE](LICENSE)。小螃蟹图标是照 Claude Code 的形象画的，该形象归 Anthropic 所有，不在本许可证范围内。
