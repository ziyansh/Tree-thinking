# Tree Thinking — Branching Chat Canvas

> Current version: **0.1.3** | [中文说明](readme.md)

Turn linear chat into an endlessly expanding tree of thought: every Q&A pair is a card on an infinite canvas, each card grows candidate follow-up arrows on its right, and clicking any arrow continues the conversation along that path. Branches keep independent context, so you can compare ideas without overwriting the main thread.

## Features

- **Infinite left-to-right canvas** powered by React Flow: pan with Space + left drag, middle drag, or press-and-drag on empty space (drift delay/distance configurable); the wheel zooms, including while Space is held.
- **Card-based Q&A**: one card = one question + one answer; answers render as Markdown and scroll inside the card instead of stretching it.
- **Selectable card text**: titles, Markdown answers, reasoning, input boxes, and note bodies can all be drag-selected; selecting text never moves the card, and the highlight uses a soft accent tone.
- **Card sizes and notes**: chat cards share one global size, adjustable from all four edges and corners (minimum 280×240); note cards keep their own size. Double-click empty canvas to create a note, then edit its title and body.
- **Compact, single-choice suggestions**: after an answer completes, N suggestion cards (default 3, configurable 2–6) plus 1 custom-input card appear as a compact vertical stack on the right. Only one can be picked per round; picking one hides the whole group, and “换一个方向” (another direction) starts a new round. Suggestion cards and the branch input bar render on separate layers and never overlap.
- **Branch input and isolated context**: branches are created from an input bar as wide as the card; long text wraps and grows the bar automatically. Press Enter to create the card. A request only contains the root-to-current path, so sibling branches never see each other.
- **Branch edges**: the main chain stays left-to-right; direct branches connect from the parent's top/bottom center to the child, and the shared bus is shared by every child of the same parent. Edges route around cards.
- **Auto layout**: cards are arranged for the current connection style; branches stay in the parent's column below it instead of being forced to the right, and the result can be undone.
- **Drag, pin, and multi-select**: any blank area of a card can be dragged while text and buttons never trigger a drag; a grab cursor is shown. Pinning locks a card in place (the root card is pinned by default); dragging moves the whole subtree. Ctrl-click toggles multi-select and batch delete, while Shift snaps to a 20px grid and nearby cards.
- **Title editing**: double-click a card title to edit it (the interval is configurable); Enter or blur commits, Esc cancels.
- **Undo and save**: each canvas keeps its own multi-step undo stack (Ctrl+Z, depth configurable); Ctrl+S saves manually and autosave is configurable. Saving does not clear undo history.
- **Multiple canvases**: a collapsible left sidebar (240px / 48px) to create, switch, rename, and delete canvases. Each canvas has exactly one root question. After the first answer completes, the app asks the model for a canvas title; a manual rename is never overwritten.
- **In-app settings**: the gear at the bottom-left opens a floating dialog with Model service / Canvas / Pointer / Save / Appearance tabs. The Model service tab lets you switch between DeepSeek and OpenAI; each provider keeps its own key, base URL, and model, and changes take effect immediately — no restart.
- **Multiple providers**: any OpenAI-compatible endpoint works. DeepSeek supports `deepseek-flash` / `deepseek-v4-pro`; OpenAI adds organization/project IDs, temperature, max output tokens, reasoning effort, and request timeout, and can point at a compatible proxy.
- **Persistence**: canvases, cards, positions, and viewport are stored in local SQLite and restored after refresh.
- **Appearance**: follow system / light / dark, plus accent hue, edge width and color; 12/24-hour time formats. Card body font size is adjustable (12–24px, default 14) and cards grow automatically when the font size increases.
- **Modified time**: chat and note cards show the last modified time at the bottom-right outside the card (`yyyy-mm-dd hh:mm`, with AM/PM in 12-hour mode), updated as edits happen.

## Quick Start

### Requirements

- Python 3.10+
- Node.js 18+ (developed and verified on Node 25)
- Windows 10/11 (the one-click script is a Windows batch file)

### One-click start (recommended)

Double-click `start.bat` in the repository root. It will:

1. Create `backend/.venv` and install backend dependencies if missing;
2. Run `npm install` if `frontend/node_modules` is missing;
3. Copy `.env.example` to `backend/.env` if the file does not exist;
4. Launch backend and frontend in two new windows and open the browser after ~8 seconds.

> API configuration is no longer part of the startup script. On first use, click the gear at the bottom-left of the page and fill in your API key — saving applies immediately.

### Manual start

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

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`.

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
5. **Manage canvases**: switch, create, rename, delete from the left sidebar; the bottom input follows the selected card.
6. **Create and edit notes**: double-click empty canvas to create a note; edit its title and body directly, and drag any edge or corner to resize it independently. Notes are excluded from auto layout and edges.
7. **Adjust appearance and interaction**: the Settings dialog at the bottom-left has five tabs:
   - **Model service**: API key, base URL, model, thinking mode, suggestion count;
   - **Canvas**: branch connection style (direct branch / shared bus);
   - **Pointer**: double-click interval (300ms by default), pointer drag drift delay (0ms by default), and drift distance (10px by default);
   - **Save**: autosave interval (0 disables it) and undo depth;
   - **Appearance**: follow system / light / dark, body font size (12–24px), accent hue, edge width and color, 12/24-hour clock.
8. **Undo and save**: `Ctrl+Z` undoes the last action on the current canvas (stacks are per-canvas); `Ctrl+S` saves the current canvas; autosave runs on the configured interval, and saving never clears undo history.

## Project Layout

```
Tree_thinking/
├─ start.bat                  # Windows one-click launcher
├─ readme.md / readme_en.md   # Chinese / English docs
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
- **How do I undo or save**: with no input focused, press `Ctrl+Z` to undo the last action on the current canvas and `Ctrl+S` to save. The autosave interval and undo depth live under Settings → Save.
- **How do I create or resize a note**: double-click empty canvas to create one; drag any edge or corner handle to resize it independently. Click to edit the title and body; the delete button sits at the right of the title bar.
- **Change defaults only**: edit `backend/.env` and restart the backend; settings saved in the UI take precedence.
- **`.env` is ignored / the commit hook blocks a commit**: this is expected — environment files and suspected keys must not enter the repository. Keep the real key in a local, ignored `.env` and commit only key-free templates such as `.env.example`; the hook prints the offending file, so remove any `sk-` key or non-empty `DEEPSEEK_API_KEY` from it and commit again.

## Changelog

Versioning: each conversation iteration bumps one minor version (0.1.x) unless a specific target version is requested.

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
