# focus-band

[中文](README.md) | English

A Claude Code mod that keeps one band above the prompt box in the desktop app: the current goal / bottleneck / write scope, plus your 5h and 7d usage limits.

![Screenshot](docs/screenshot.png)

Status: 0.13.0, frozen on 2026-10-02. `claude plugin validate` passes, `claude plugin test` passes 13 tests.

The labels in the band and the command replies are in Chinese (终点 = goal, 瓶颈 = bottleneck, 范围 = scope).

## Install

Requires a Claude Code build with mods support (2.1.286 or later). Run this in a terminal, then start a new session:

```bash
claude plugin marketplace add chaoshengsc/focus-band && claude plugin install focus-band@chaoshengsc
```

Update with `claude plugin marketplace update chaoshengsc`; uninstall with `claude plugin uninstall focus-band@chaoshengsc`.

Layout: `.claude-plugin/plugin.json` (manifest), `hooks/register.tsx` (all the logic), `types/index.d.ts` (state contract), `tests/` (tests).

## Usage

- `/focus goal | bottleneck | scope`: set the focus; no argument shows it; `/focus clear` removes it
- `/focus-style 1|2|3`: standard / one line / footer
- `/focus-color`: change the progress-bar color (on desktop, clicking the small crab on the right does the same)
- The model updates the focus with the `set_focus` tool; each prompt carries one line with the current focus for the model (the user never sees it)

## Known limits (by design of the host, not a to-do list)

- The grey backing is drawn by the desktop app. A mod cannot change its color, corner radius or height, and cannot draw outside its own row
- Usage figures come from the last model response, so they lag behind the usage panel while this session is idle or another session is spending
- A row is about 19px tall; a taller icon makes the band taller. The button's focus ring is clipped at the top and bottom
- Styles 2 and 3 do not show the scope (intentional)

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
