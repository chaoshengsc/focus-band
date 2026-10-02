# focus-band

English | [中文](README.zh.md)

A Claude Code mod that keeps your usage limits in view above the prompt box in the desktop app: the 5h and 7d windows, each with a thin progress bar, the percentage and the reset time.

![Screenshot](docs/screenshot.png)

Status: 0.16.1. `claude plugin validate` passes, `claude plugin test` passes 7 tests.

The bar turns orange from 80% and red from 90%; the numbers stay in the text color. Once a window's reset time has passed, its figure shows `—` until a fresh reading arrives.

Earlier versions also showed a goal / bottleneck / scope line above the bars. It was removed in 0.16.0: it depended on the model keeping it current and went stale too often.

## Install

Requires a Claude Code build with mods support (2.1.286 or later). Run this in a terminal, then start a new session:

```bash
claude plugin marketplace add chaoshengsc/focus-band && claude plugin install focus-band@chaoshengsc
```

Update with `claude plugin marketplace update chaoshengsc`; uninstall with `claude plugin uninstall focus-band@chaoshengsc`.

Layout: `.claude-plugin/plugin.json` (manifest), `hooks/register.tsx` (all the logic), `types/index.d.ts` (state contract), `tests/` (tests).

## Usage

One command, three subcommands; without a value each picks the next option:

- `/band color [1-7 | name]`: progress-bar color (on desktop, clicking the small crab on the right does the same)
- `/band style [1 | 2]`: where it sits, 1 above the prompt box (bars, reset times), 2 in the footer next to the model name (text only, e.g. `5h 47%  7d 69%`)
- `/band lang [zh | en]`: language of the command replies; defaults to Chinese when the system locale is Chinese, English otherwise

## Known limits (by design of the host, not a to-do list)

- The grey backing is drawn by the desktop app. A mod cannot change its color, corner radius or height
- Usage figures come from the last model response, so they lag behind the usage panel while this session is idle or another session is spending
- A row is about 19px tall; a taller icon makes the band taller. The button's focus ring is clipped at the top and bottom
- The desktop app only picked up the first slash command a mod registers, which is why everything lives under `/band`

## After changing the code

```bash
claude plugin validate ~/.claude/skills/focus-band
```

```bash
claude plugin test ~/.claude/skills/focus-band
```

Restart the session for changes to take effect.

## License

MIT, see [LICENSE](LICENSE). The crab icon is drawn after the Claude Code mascot, which belongs to Anthropic and is not covered by this license.
