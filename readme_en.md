# Tree Thinking — Branching Chat Canvas

> Current version: **0.2.2** | [中文说明](readme.md)

Turn linear chat into an endlessly expanding tree of thought: every Q&A pair is a card on an infinite canvas, each card grows candidate follow-up arrows on its right, and clicking any arrow continues the conversation along that path. Branches keep independent context, so you can compare ideas without overwriting the main thread.

## Features

- **Infinite left-to-right canvas** powered by React Flow: pan with Space + left drag, middle drag, or press-and-drag on empty space (drift delay/distance configurable); while Space is held, dragging anywhere — card text, titles, attachments, or an unfocused input — pans the canvas. Wheel behavior is configurable under Settings → Canvas → Pointer → Wheel logic: scroll the hovered card or zoom the canvas; zoom still works while Space is held.
- **Card-based Q&A**: one card = one question + one answer; answers render as Markdown and scroll inside the card instead of stretching it.
- **Selectable card text**: titles, Markdown answers, reasoning, and input boxes can be drag-selected; selecting text never moves the card. While Space is held, panning takes priority and no text is selected. Note titles and bodies become selectable after double-clicking into edit mode. The highlight uses a soft accent tone.
- **Card sizes and notes**: chat cards share one global size, adjustable from all four edges and corners (minimum 280×240); note cards keep their own size. Double-click empty canvas to create a note; double-click its title or body to edit (single click is reserved for dragging and selection), and press Tab in the body editor to insert four spaces.
- **Compact, single-choice suggestions**: after an answer completes, N suggestion cards (default 3, configurable 2–6) plus 1 custom-input card appear as a compact vertical stack on the right. Only one can be picked per round; picking one hides the whole group, and “换一个方向” (another direction) starts a new round. Suggestion cards and the branch input bar render on separate layers and never overlap.
- **Branch input and isolated context**: branches are created from an input bar as wide as the card; long text wraps and grows the bar automatically. Press Enter to create the card. A request only contains the root-to-current path, so sibling branches never see each other.
- **Branch edges**: the main chain stays left-to-right; direct branches connect from the parent's top/bottom center to the child, and all non-main branches of one parent share a single bus. Edges route around cards.
- **Auto layout**: the root card keeps its current position and the main chain always stays on one horizontal line. In direct mode branch heads sit directly below their parent in the same column; in bus mode they sit in the next column to the right and share one bus. Row/column spacing is controlled by Settings → Canvas → Card spacing.
- **Drag, pin, and multi-select**: any blank area of a card can be dragged while text and buttons never trigger a drag; a grab cursor is shown. Pinning locks a card in place (the root card is pinned by default); dragging moves the whole subtree. Ctrl-click toggles multi-select and batch delete, while Shift snaps to a 20px grid and nearby cards.
- **Title editing**: double-click a card title to edit it (the interval is configurable); Enter or blur commits, Esc cancels.
- **Undo and save**: each canvas keeps its own multi-step undo stack (Ctrl+Z, depth configurable, including card-size changes); Ctrl+S saves manually and autosave is configurable. Saving does not clear undo history. Select one or more cards and press `Delete` to remove them quickly.
- **Multiple canvases**: a collapsible left sidebar (240px / 48px) to create, switch, rename, and delete canvases. Each canvas has exactly one root question. After the first answer completes, the app asks the model for a canvas title; a manual rename is never overwritten.
- **In-app settings**: the gear at the bottom-left opens a floating dialog with three tabs — Model service / Canvas / Appearance (save options live in Canvas). Each section has a heading, with a description on the left and the control on the right; bounded values use a slider plus a number input, and changes take effect immediately — no restart.
- **Multiple providers**: the provider is a dropdown (DeepSeek / OpenAI-compatible); the latter works with any service that implements the OpenAI protocol. DeepSeek supports `deepseek-flash` / `deepseek-v4-pro`; the OpenAI-compatible option adds organization/project IDs, temperature, max output tokens, reasoning effort, and request timeout, and can point at a proxy.
- **Web search**: a toggle sits next to “Auto layout” at the canvas top-left (DeepSeek only), and a synced shortcut sits beside the attachment button in card inputs. When enabled, the app calls DeepSeek Search before answering and injects a summary; the number of sources can be capped under Settings → Model service → General → “Model search limit” (default 0 means unlimited). Cards show “参考 N 篇资料” at the bottom-left; clicking it slides up a draggable frosted-glass drawer inside the card (25% of the card height by default; the height is remembered and applied to every card). The drawer lists numbered page titles linked to the originals, and `[n]` markers in answers render as clickable citation badges; the drawer closes only via its arrow or Esc.
- **Attachments**: the root question input and the “custom direction” box accept click-to-upload or drag-and-drop files. Cards show every attachment as a file icon plus filename (more than three collapse into “附件 N”; clicking an item opens the original file in a new window). Text attachments are injected along the root-to-current path, so sibling branches never see them.
- **Persistence**: canvases, cards, positions, and viewport are stored in local SQLite and restored after refresh.
- **Appearance**: follow system / light / dark, plus accent hue, edge width and color; 12/24-hour time formats. Card body font size is adjustable (12–24px, default 14) and cards grow automatically when the font size increases.
- **Modified time**: chat and note cards show the last modified time at the bottom-right outside the card (`yyyy-mm-dd hh:mm`, with AM/PM in 12-hour mode), updated as edits happen.

## Quick Start

### Requirements

- Python 3.10+
- Node.js 18+ (developed and verified on Node 25)
- Windows 10/11 or macOS 12+ (Intel / Apple Silicon)
- Linux can also use `start.sh`; the project is developed on Windows, and macOS/Linux have not been tested on real hardware yet

### One-click start (recommended)

**Windows**: double-click `start.bat` in the repository root.

**macOS**: run this in the repository root:

```bash
bash start.sh
# or run chmod +x start.sh once, then ./start.sh
```

Both launchers:

1. Create `backend/.venv` and install backend dependencies if missing;
2. Run `npm install` if `frontend/node_modules` is missing;
3. Copy `.env.example` to `backend/.env` if the file does not exist;
4. Start backend and frontend, wait until ready, and open the browser. The macOS launcher writes logs to `.runtime/`, and `Ctrl+C` stops both services.

> API configuration is not part of the startup script. On first use, click the gear at the bottom-left of the page and fill in your API key — saving applies immediately.

> When moving between Windows and macOS, delete `backend/.venv` and `frontend/node_modules` first, then run the launcher again so dependencies are reinstalled for the current platform.

### Manual start

**Windows (PowerShell)**

```powershell
# Terminal 1: backend
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

**macOS / Linux (zsh / bash)**

```bash
# Terminal 1: backend
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --port 8000 --reload

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`.

Paths: the database and upload directories default to repo-relative `backend/data/...` on both Windows and macOS; `DB_PATH` / `UPLOAD_DIR` also accept `~` (e.g. `~/tree-thinking/app.db`), so no platform-specific separators are needed.

## Configuration

Precedence: **in-app settings > `backend/.env`**. Settings are stored in `backend/data/app.db` and never leak into frontend bundles.

| `backend/.env` key | Description | Default |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API key; answers fail when empty | empty |
| `DEEPSEEK_BASE_URL` | OpenAI-compatible base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Model name | `deepseek-flash` |
| `THINKING_ENABLED` | Enable thinking mode | `true` |
| `SUGGESTION_COUNT` | Number of suggestion arrows (2–6) | `3` |
| `DB_PATH` | SQLite file path | `backend/data/app.db` |

Notes:

- The in-app settings cover the first five options. Leaving base URL or model empty restores the `.env` default.
- The API key stays on the backend. The settings API only returns a masked value (e.g. `sk-••••7890`).
- Get a key at <https://platform.deepseek.com/api_keys>.

## Security & Secret Protection

- `.gitignore` already excludes `.env*` (keeping `.env.example`), database files such as `*.db` / `*.sqlite*`, virtualenvs, dependencies, and build output.
- `.githooks/pre-commit` scans staged content before each commit and aborts when it finds a long `sk-…` string or a non-empty `DEEPSEEK_API_KEY`, printing the offending file (`*.env.example` is skipped).
- Enable the pre-commit hook once — every later commit in this repository is then checked automatically:

```powershell
git config core.hooksPath .githooks
```

## Usage

1. **Ask the root question**: a canvas is created automatically; the root card is in input mode.
2. **Watch the stream**: the answer arrives token by token; expand “Thinking” to read the reasoning when enabled.
3. **Choose the next step**:
   - Click a suggestion card to create a full chat card in place and continue along that direction; only one can be picked per round, and the group hides after the pick;
   - Type into the full-width input bar below a card and press Enter to create a custom branch; the bar can be reused;
   - “换一个方向” starts a new round of suggestions; the branch button at the card bottom opens the input bar again.
4. **Compare branches**: any card can fork; branches never share content created after the fork.
5. **Manage canvases**: switch, create, rename, delete from the left sidebar; follow-up questions are entered directly on cards.
6. **Create and edit notes**: double-click empty canvas to create a note; double-click its title or body to edit (single click is reserved for dragging), and press Tab in the body editor to insert four spaces. Drag any edge or corner to resize it independently. Notes are excluded from auto layout and edges.
7. **Adjust appearance and interaction**: the Settings dialog at the bottom-left has three tabs:
   - **Model service**: provider (dropdown: DeepSeek / OpenAI-compatible), API key, base URL, model, thinking mode, suggestion count;
   - **Canvas**: connection style (direct branch / shared bus), card spacing (80px by default, shared by new cards and auto layout), wheel logic in the pointer section, double-click interval, pointer drift delay and distance, autosave interval and undo depth;
   - **Appearance**: follow system / light / dark, body font size (12–24px), accent hue (with a reset button), edge width and color, 12/24-hour clock.
8. **Undo, save, and delete**: `Ctrl+Z` undoes the last action on the current canvas (stacks are per-canvas and include card-size changes); `Ctrl+S` saves the current canvas; autosave runs on the configured interval, and saving never clears undo history. Select one or more cards and press `Delete` to remove them quickly (the root question card still cannot be deleted).

## Keyboard Action Priority

When a single key triggers several eligible actions, the **most recently executed/opened action runs first**; pressing the key again falls back to earlier actions.

For example, with reference drawers open on two cards, the first `Esc` closes the drawer that was opened last, and the second `Esc` closes the earlier one.

This rule applies to every new shortcut and overlay. It is implemented by the shared Escape action stack (`frontend/src/lib/escapeStack.ts`); reuse it instead of registering a separate window-level Esc listener. See [docs/development.md](docs/development.md) for details.

## Project Layout

```
Tree_thinking/
├─ start.bat / start.sh       # Windows / macOS one-click launchers
├─ readme.md / readme_en.md   # Chinese / English docs
├─ docs/development.md        # development conventions (keyboard priority)
├─ backend/
│  ├─ .venv/                  # isolated virtualenv (not committed)
│  ├─ requirements.txt
│  ├─ app/
│  │  ├─ main.py              # FastAPI entry
│  │  ├─ db.py, models.py, schemas.py, config.py
│  │  ├─ api/                 # projects / nodes / settings
│  │  └─ services/            # llm / context / suggestions / settings / graph
│  └─ tests/                  # pytest unit and API tests
└─ frontend/
   ├─ vite.config.ts          # port 5173 + /api proxy
   └─ src/
      ├─ api/                 # client / sse / mock / types
      ├─ canvas/              # Canvas / CardNode / Ghost nodes / layout
      ├─ components/          # Sidebar / SettingsDialog
      ├─ store/               # Zustand graph state
      └─ styles/theme.css     # theme tokens (light/dark)
```

## Tech Stack

- Frontend: React 19, TypeScript, Vite, @xyflow/react (React Flow 12), Zustand, Tailwind CSS v4, react-markdown, dagre
- Backend: Python 3.10, FastAPI, SQLAlchemy 2.0, SQLite, openai SDK (DeepSeek-compatible)
- Streaming: SSE (`text/event-stream` from the backend, parsed with fetch + ReadableStream in the frontend)

## FAQ

- **“API key not configured” on a card**: open Settings at the bottom-left, paste the key, and save. No restart needed.
- **Port already in use**: run the backend with `--port 8001` and update the proxy target in `frontend/vite.config.ts`.
- **Reset all data**: stop the backend, delete `backend/data/app.db`, and start again.
- **Slow answers / no reasoning panel**: check the thinking-mode switch and the selected model in Settings.
- **How do I switch themes**: open Settings → Appearance and choose follow system / light / dark; accent hue, edge width, and edge color are adjustable there too.
- **How do I undo or save**: with no input focused, press `Ctrl+Z` to undo the last action on the current canvas (including card-size changes) and `Ctrl+S` to save. Select cards and press `Delete` for quick deletion. The autosave interval and undo depth live under Settings → Canvas.
- **How do I create or resize a note**: double-click empty canvas to create one; drag any edge or corner handle to resize it independently. Double-click the title or body to edit; press Tab in the body editor to insert four spaces. The delete button sits at the right of the title bar.
- **Change defaults only**: edit `backend/.env` and restart the backend; settings saved in the UI take precedence.
- **`.env` is ignored / the commit hook blocks a commit**: this is expected — environment files and suspected keys must not enter the repository. Keep the real key in a local, ignored `.env` and commit only key-free templates such as `.env.example`; the hook prints the offending file, so remove any `sk-` key or non-empty `DEEPSEEK_API_KEY` from it and commit again.

## Changelog

Versioning: each conversation iteration bumps one minor version (0.1.x) unless a specific target version is requested.

### 0.2.2 — 2026-11-12
- Search: removed the hard-coded 10-result cap (search previously truncated both the request and the prompt); added Settings → Model service → General → “Model search limit”, default 0 (unlimited), accepting 1–50.
- Canvas: macOS / Windows trackpad support — two-finger scroll pans the canvas, pinch zooms it, and the mouse wheel still follows the “Wheel logic” setting; scrollable areas such as card answers, reasoning, and the references drawer keep native scrolling.
- Settings: numeric inputs now sync valid values as you type, so clicking Save right after editing no longer loses the change.
- Bumped the version to 0.2.2.

### 0.2.1 — 2026-11-08
- Added a macOS / Linux one-command launcher `start.sh`: it creates `backend/.venv`, installs backend and frontend dependencies, copies `.env`, checks ports 8000/5173, waits until the services are ready, and opens the browser; `Ctrl+C` stops both services and logs go to `.runtime/`.
- The bilingual README now documents macOS requirements, the one-command flow, and `.venv/bin/python` manual commands; database and upload paths remain repo-relative and `pathlib`-based on both Windows and macOS.
- Bumped the version to 0.2.1.

### 0.2.0 — 2026-11-06
- Motion: introduced a unified duration and easing scale (120–150ms for high-frequency feedback, 200ms for local changes, 280ms for hierarchy changes) plus press-scale feedback on every button; all animations can be interrupted by the next action.
- Motion: the settings dialog now fades in its overlay and lifts its panel into view, plays a 180ms exit before unmounting, and fades tab content on switch.
- Motion: newly created cards and notes play a one-shot 220ms entrance (no bounce); dragged cards scale to 1.01 and hovered cards lift by 1px.
- Motion: the reasoning section expands/collapses smoothly with 0fr ↔ 1fr; the references drawer rises from the bottom, follows the pointer while dragging, and transitions height over 220ms otherwise.
- Motion: canvas panning (blank-area drag or Space + drag) coasts with pointer velocity after release and stops immediately on the next press; auto-arrange now interpolates positions frame by frame over 280ms so edges move in sync, and dragging takes over at any time.
- Motion: toasts rise and fade in, then fade out before unmounting; attachment chips and error banners animate in.
- Settings: Canvas → Display gains a “Canvas pan inertia” toggle (off by default); when enabled, an “Inertia coefficient” slider + number input appears (0.1–1.0, default 0.5).
- Settings: new “Canvas style” choice — None / Dots. Dots renders a regular dot grid, and holding Shift while panning snaps the viewport to the dot spacing.
- Fixed: wheel zoom could run while pan inertia was still gliding; zooming now stops inertia immediately.
- Fixed: after expanding one “custom direction” composer, clicking another custom-direction composer now collapses the previous one (treated as a focus change).
- Performance: fixed card-drag stutter — removed scale/translate animations from dragging and hovering, using shadow for the lift instead; drag offsets are coalesced per animation frame so high-refresh pointer events no longer trigger per-event re-renders.
- Sidebar: the new-canvas “+” icon is now a labeled “新建画布” button in the expanded sidebar (the collapsed rail keeps the icon).
- Reference drawer: entries are numbered page titles linking to the originals; the entry arrow now points up when expanded.
- Web citations: the search prompt asks the model to mark citations as `[n]`, and answers render those numbers as clickable citation badges that open the matching source.
- Performance: canvas animations are scheduled with a 60fps cap (dragging, pan inertia, auto-arrange), so high-refresh displays no longer trigger redundant state writes; streamed answers batch text at ~30fps to keep Markdown re-parsing from stealing animation frames; the settings dialog no longer uses a full-screen backdrop blur or scale animation, and dragging disables shadow transitions and large glass blurs.
- Accessibility: honors the system “Reduce motion” setting and downgrades translation, scaling, inertia, and auto-arrange interpolation to a 120ms cross-fade.
- The sidebar still expands/collapses without animation to avoid pushing the entire canvas viewport.
- Bumped the version to 0.2.0.

### 0.1.6 — 2026-11-05
- Added: while Space is held, dragging anywhere — card text, titles, attachments, or an unfocused input — pans the canvas without selecting text.
- Added: a web-search shortcut beside the attachment button in card inputs, synced with the canvas-top toggle; hovering shows “仅支持 DeepSeek API” on other providers.
- Added: select one or more cards and press `Delete` for quick deletion (the root question card remains protected).
- Added: undo now restores card-size changes.
- Improved: the “custom direction” input becomes a toggle-style expanded composer. Once clicked it stays open; only clicking another card or a suggestion collapses it, while clicking empty canvas does not.
- Improved: attachments are unified as “file icon + filename”; images no longer show thumbnails or a viewer, and every attachment opens the original file in a new window when clicked.
- Improved: the reference drawer lists web links only, without fetched titles, summaries, or page content.
- Added: note titles and bodies now require a double-click to enter edit mode, leaving single-click for dragging and selection; pressing Tab in the body editor inserts four spaces.
- Added: a new “Wheel logic” setting is the first item under Settings → Canvas → Pointer, offering “scroll the hovered card” or “zoom the canvas” (zoom by default); while Space is held, the wheel always zooms the canvas.
- Fixed: wheel zoom works again when the pointer is over card answers or reasoning (including while Space is held).
- Improved: references now open as an in-card draggable frosted-glass drawer (25% of the card height by default, resizable and remembered globally) that never covers the bottom action row and closes only via its arrow or Esc.
- Improved: unified keyboard priority — when one key matches several actions, the most recently executed/opened action runs first (see “Keyboard Action Priority”).
- Removed: the global bottom-center follow-up input bar; all follow-ups now happen on cards.
- Bumped the version to 0.1.6.

### 0.1.5 — 2026-11-05
- Fixed: a card created from the branch input now uses the backend's unified position (matching Card spacing, without an extra blank row).
- Fixed: suggestion cards now display in full, wrap automatically, and size themselves to their content.
- Fixed: removed the “Empty canvas” subtitle from sidebar canvas entries.
- Fixed: while Space or the middle mouse button is held, every drag pans the canvas.
- Settings: reduced to three tabs — Model service / Canvas / Appearance — with Save folded into Canvas; section headings with a description on the left and the control on the right; bounded values use a slider plus a number input; the accent hue uses a rainbow gradient with a reset button; out-of-range values are corrected on blur, and save failures show the backend reason.
- Settings: the provider is now a dropdown named “OpenAI 兼容” (OpenAI-compatible), supporting any OpenAI-protocol service; key hints no longer mention `sk-`.
- Web search: added a toggle next to “Auto layout” at the canvas top-left (DeepSeek only); before answering, DeepSeek Search results are injected as a summary. Cards show “参考 N 篇资料” at the bottom-left with a source popover (Esc or a second click closes it).
- Attachments: the root question input and the custom-direction box accept click or drag-and-drop uploads; cards show attachments at the top-left (image thumbnails, more than three collapse into “附件 N”, hover expands temporarily and click pins); clicking an image opens a viewer with wheel zoom, drag panning, and Esc to close; the custom-direction box expands into a multi-line panel on focus.
- Attachments: text and image attachments are injected along the root-to-current path, so sibling branches cannot see each other's files.
- Polish: card titles are one pixel larger; the fork button now reads “New branch”.
- Bumped the version to 0.1.5.

### 0.1.4 — 2026-11-04
- Added Settings → Canvas → Card spacing (80px by default, range 16–1200), shared by newly created cards and auto layout.
- Rewrote auto layout: the root card keeps its position; every card's first child is always the main branch and stays on the parent's horizontal line.
- Direct mode: branch heads sit directly below their parent in the same column and connect from the parent's top/bottom centers; spacing is much tighter.
- Bus mode: branch heads sit in the next column to the right, aligned with the main child column, and all sibling branches share one bus.
- Enlarged the Settings dialog (fonts and controls scaled up) and merged the Pointer tab into Canvas.
- Bumped the version to 0.1.4.

### 0.1.3 — 2026-11-04
- Holding Space no longer turns the wheel into vertical scrolling; the wheel always zooms.
- Card modified time now uses `yyyy-mm-dd hh:mm`; text selection highlight was redesigned with a soft accent tone.
- Added automatic canvas naming: after the first answer completes, the model generates a title; manual renames are never overwritten, and submitting the same name does not count as a rename.
- Empty-canvas panning now uses a drift delay + drift distance instead of long-press; the Motion tab became Pointer (double-click interval / drift delay / drift distance).
- Canvas panning and card dragging show grab cursors; any blank card area can drag the card while text and buttons do not.
- The branch input bar now matches the card width and grows automatically as text wraps.
- Direct branches connect from the parent's top/bottom center; a first branch no longer renders as a main-chain edge. Every child of a parent shares the bus edge in bus mode.
- Auto layout keeps branches below their parent instead of forcing them right; same-column branch spacing is reduced from 120px to 64px.
- Bumped the version to 0.1.3.

### 0.1.2 — 2026-11-04
- Added a provider selector at the top of Settings → Model service: DeepSeek / OpenAI; switching takes effect on the next question.
- Each provider keeps its own key, base URL, and model, so switching never overwrites the other one; existing DeepSeek settings are reused automatically.
- Selecting OpenAI exposes detailed options: Organization ID, Project ID, temperature (not sent by default), max output tokens, reasoning effort, and request timeout.
- OpenAI requests now use `max_completion_tokens` / `temperature` / `reasoning_effort` as configured and no longer send DeepSeek-specific thinking parameters.
- When the active provider has no key, the error message names that provider.
- Bumped the version to 0.1.2.

### 0.1.1 — 2026-11-04
- Card titles, Markdown answers, reasoning, input boxes, and note bodies now support drag-selecting text without moving the card.
- The default long-press duration for panning on empty canvas changed from 300ms to 150ms (range still 50–5000ms).
- Added Appearance → Body font size (12–24px, default 14); increasing the size grows cards proportionally from 14px→400×560, while decreasing it never shrinks them back.
- Bumped the version to 0.1.1.

### 0.1.0 — 2026-11-03
- Fixed the z-order overlap between suggestions and the branch input; added card pinning (the root card is pinned by default).
- Branch input is now a full-width bar below the card and creates a card on Enter; edges support direct branches and a shared bus, and route around cards.
- Auto layout treats the root question as an independent item, distinguishes the main trunk from forks, and follows the active connection style.
- Added per-canvas multi-step undo (Ctrl+Z) and manual/automatic save (Ctrl+S); saving does not affect undo.
- Added double-click title editing, Space/middle/long-press panning, Ctrl multi-select with batch delete, four-edge/four-corner resizing, and Shift snapping.
- Added note cards (created by double-clicking empty canvas, with independent size) and card modified-time display.
- Added appearance settings: accent hue, edge width/color, follow system/light/dark, and 12/24-hour clock.
- Bumped the version to 0.1.0.

### 0.0.3 — 2026-11-03

- Hardened secret-leak protection: `.gitignore` rules and a pre-commit scanning hook.
- Cards now share one global size, adjustable by dragging the right/bottom edge (no maximum, minimum 280×240), kept across canvases and restarts.
- Suggestions are now standalone cards in a compact vertical stack; clicking one expands it into a full card.
- Suggestions are now single-choice: the whole group hides after a pick and that state is persisted; “换一个方向” starts a new round.
- Single-chain conversations now use a horizontal same-level layout; added a “New branch” button.
- The root card is fixed; dragging a card moves its entire subtree.
- Bumped the version to 0.0.3.

### 0.0.2 — 2026-11-03

- Added the in-app settings dialog (floating window with a tabbed inner sidebar) for API key, base URL, model, thinking mode, and suggestion count, applied immediately without restarting.
- Added bilingual README files at the repository root (`readme.md` and `readme_en.md`).
- Simplified `start.bat` into a pure launcher; removed the API-key prompt and pointed users to the in-app settings.
- Bumped the version to 0.0.2.

### 0.0.1 — 2026-11-02

- First usable release: infinite canvas, chat cards, suggestion arrows, per-branch context isolation, multi-canvas sidebar, DeepSeek streaming with collapsible reasoning, SQLite persistence, and the dark theme.
