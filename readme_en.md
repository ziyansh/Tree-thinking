# Tree Thinking — Branching Chat Canvas

> Current version: **0.3.14** | [中文说明](readme.md)
>
> **WIP**: this project is still under active development; features and UI may change at any time and do not represent final quality.
>
> **Platforms**: Windows 10/11 is the primary target; macOS is supported in theory; Linux has only been verified for server deployment.

Turn linear chat into an endlessly expanding tree of thought: every Q&A pair is a card on an infinite canvas, each card grows candidate follow-ups on its right, and picking one continues along that path. Branches keep independent context, so you can compare ideas without scrolling back through a long chat log.

## Features

- **A conversation that becomes a map**: each card holds exactly one question and one answer, then offers several next directions. Pick one to continue in the current context, or start a branch of your own. Branches never overwrite each other, so comparing ideas stays easy.
- **Notes live on the canvas**: double-click empty space to create a note, drag it anywhere, and attach it to an answer card with a light link. Notes are not part of the conversation and never enter the model context.
- **Ask with your material**: drop images, PDFs, text, video, or audio into the input. Attachments collapse when there are several, and each one opens in its original form; long PDFs warn about cost and context risk before you submit.
- **Thinking and web search stay inside the card**: reasoning is folded into the card and expands when needed; with web search on, answers list their sources at the bottom-left and open a source drawer from the card.
- **Local or online, one codebase**: local mode is single-user with no login by default; server mode adds multi-account registration and keeps canvases, attachments, settings, and keys isolated per account.
- **Daily work stays on the canvas**: drag, zoom, pin, multi-select, undo, autosave, and export/import all happen in place, and card layering follows the focus automatically.
- **Search is always at hand**: `Ctrl+F` searches card titles and bodies within the current canvas, while the search box at the top of the sidebar searches across every canvas; a single click aims the camera at the matched keyword and flashes a highlight in the card, and sidebar jumps also fit a suitable zoom. The in-canvas panel can be resized and remembers its size.

See [docs/features_en.md](docs/features_en.md) for the complete feature and behavior reference.

## Quick Start

### Install the prerequisites

Three tools are required:

| Tool | Version | Purpose | Download |
| --- | --- | --- | --- |
| Git | Any recent version | Fetch the source | <https://git-scm.com/downloads> |
| Python | 3.10 or newer | Run the backend | <https://www.python.org/downloads/> |
| Node.js | 20.19 or newer (includes npm) | Run and build the frontend | <https://nodejs.org/> |

Notes for Windows:

- **Python**: on the first page of the installer, tick “Add python.exe to PATH”; otherwise `python` will not be found in the terminal.
- **Node.js**: the LTS installer is fine and includes `npm`.
- **Git**: the default options are fine; Git Bash is available from the Start menu afterwards.

After installing, open a new terminal window and check the versions:

```powershell
git --version
python --version
node --version
npm --version
```

On macOS you can use Homebrew (`brew install git python node`; install Homebrew from <https://brew.sh> first). On Linux, install Git, Python 3, and `python3-venv` with your package manager, and install Node.js 20.19+ through NodeSource or nvm.

### Get the source

Clone the repository and enter the project directory:

```bash
git clone https://github.com/ziyansh/Tree-thinking.git
cd Tree-thinking
```

All following commands run inside this `Tree-thinking` directory. If you downloaded a zip archive, extract it and enter the extracted folder instead.

### Server deployment

Hosting it for several people? Clone the code as above, then read the [server deployment guide](docs/deploy_en.md). It covers server dependencies, environment variables, systemd, Nginx, HTTPS, backups, and upgrades.

### Windows

Windows 10/11 is the primary supported platform.

#### One-click start

Open the cloned `Tree-thinking` folder in File Explorer and double-click `start.bat`. The script will:

1. check Python and Node.js;
2. create `backend/.venv` and install backend dependencies;
3. copy `.env.example` to `backend/.env` when it is missing;
4. install frontend dependencies;
5. start the backend and frontend, then open `http://localhost:5173` in the browser.

Two console windows stay open; closing a window stops that service. The first run downloads dependencies and may take a while depending on your network.

#### Manual start

Open two PowerShell windows and enter the project directory in both:

```powershell
cd Tree-thinking
```

**Window 1: backend**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Window 2: frontend**

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:8000`.

### macOS and Linux

macOS is supported in theory: the code and dependencies are cross-platform, but it has not been fully tested. Linux has only been verified for server deployment; local desktop use has not been tested.

Install Git, Python 3.10+, and Node.js 20.19+ as described in “Install the prerequisites”, then clone the code and open two terminals:

**Terminal 1: backend**

```bash
cd Tree-thinking/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2: frontend**

```bash
cd Tree-thinking/frontend
npm install
npm run dev
```

Open `http://localhost:5173`. For server deployment, follow [docs/deploy_en.md](docs/deploy_en.md).

### Deploy from source

Development mode (`npm run dev`) is not meant to serve public traffic. After cloning the code and installing dependencies:

1. run the backend with `uvicorn app.main:app` from the virtualenv, without `--reload`, under a process manager such as systemd;
2. run `npm run build` in the frontend and serve the generated `frontend/dist` with Nginx or another static server;
3. reverse-proxy `/api` to the backend port and enable HTTPS.

See the [server deployment guide](docs/deploy_en.md) for environment variables, Nginx configuration, backups, and upgrades.

## Usage

1. **Ask the root question**: a canvas is created automatically and the root card is ready for input.
2. **Watch the answer**: text streams in; with thinking mode enabled, expand “Thinking” to read the reasoning.
3. **Choose the next step**:
   - click a suggestion card to create a full chat card along that direction;
   - type your own question in the input bar below a card;
   - “another direction” starts a new round of suggestions.
4. **Compare branches**: any card can fork, and later content in one branch never affects another.
5. **Manage canvases**: create, switch, rename, and delete canvases from the left sidebar.
6. **Take notes**: double-click empty space to create a note; double-click its title or body to edit; drag its edges to resize.
7. **Adjust settings**: the gear at the bottom-left opens Model service / Canvas / Appearance tabs, and changes apply immediately.
8. **Search**: `Ctrl+F` searches card titles and bodies within the current canvas; the sidebar search box searches all canvases. A single click aims the camera at the matched keyword: in-canvas search keeps the highlight after flashing, while sidebar search only flashes and then returns the text to normal; sidebar jumps switch the canvas first and then fit the zoom. Only a quick double-click on the same in-canvas result zooms to 100%.
9. **Undo, save, delete**: `Ctrl+Z` undoes, `Ctrl+S` saves, and `Delete` removes selected cards (the root question card excluded).

More details are in [docs/features_en.md](docs/features_en.md).

## FAQ

**A card says “API key not configured”. What should I do?**

Open Settings at the bottom-left, paste the key, and save. No restart is needed.

**The port is already in use. What should I do?**

Run the backend with `--port 8001` and update the proxy target in `frontend/vite.config.ts`.

**How do I wipe all data?**

Stop the backend, delete `backend/data/app.db`, then start again.

**Answers are slow or show no reasoning. What should I check?**

Check thinking mode and the model name under Settings → Model service.

**How do I change the theme?**

Settings → Appearance offers follow system / light / dark, plus accent hue and edge colors.

**How do I only change the defaults?**

Edit `backend/.env` and restart the backend; values saved in the page take precedence.

**Why do trackpad gestures not work?**

Trackpad support is experimental. Switch “Settings → Canvas → Pointer → Pointer device” to “Trackpad (experimental)”; two-finger swipes pan the canvas, pinches zoom it, and holding Space also pans with two fingers. It has not been fully tested on all devices and trackpad drivers may behave differently; switch back to “Mouse” to restore standard wheel behavior. However, be aware that the trackpad support is not as stable as using the mouse.

**Why does the Windows console show escape codes such as `[32mINFO[0m`?**

Old consoles do not parse ANSI colors. Run `start.bat` in Windows Terminal, or run `reg add "HKCU\Console" /v VirtualTerminalLevel /t REG_DWORD /d 1 /f` and reopen the window.

**Is it normal that `.env` is ignored by Git?**

Yes, this is expected. Before committing, make sure `backend/.env`, real keys, and database files are not staged.

## Project Layout

```
Tree_thinking/
├─ start.bat                  # Windows one-click launcher
├─ readme.md / readme_en.md   # Chinese / English docs
├─ LICENSE / NOTICE           # Apache 2.0 license, copyright and trademark notice
├─ docs/
│  ├─ features.md / features_en.md   # feature reference
│  ├─ deploy.md / deploy_en.md       # server deployment guide
│  └─ development.md                 # development conventions
├─ backend/
│  ├─ .venv/                  # isolated virtualenv (not tracked)
│  ├─ requirements.txt
│  ├─ app/
│  │  ├─ main.py              # FastAPI entry point
│  │  ├─ db.py, models.py, schemas.py, config.py
│  │  ├─ api/                 # auth / projects / nodes / links / attachments / models / settings / search
│  │  └─ services/            # auth / llm / context / attachments / citations / suggestions / search / naming / settings / graph / urls
│  └─ tests/                  # pytest unit and API tests
└─ frontend/
   ├─ vite.config.ts          # port 5173 + /api proxy
   └─ src/
      ├─ api/                 # client / sse / mock / types
      ├─ canvas/              # Canvas / CardNode / attachments / note links / layout
      ├─ components/          # Sidebar / SettingsDialog / AuthPage
      ├─ lib/                 # escapeStack / theme / time / urlChips helpers
      ├─ store/               # Zustand graph state
      └─ styles/theme.css     # theme tokens (light / dark)
```

Tech stack: React 19, TypeScript, Vite 8, @xyflow/react 12, Zustand 5, and Tailwind CSS v4 on the frontend; FastAPI, SQLAlchemy 2, and SQLite on the backend; streaming answers use SSE.

## License

### Apache 2.0

This project is licensed under the Apache License 2.0. The full terms are in [LICENSE](LICENSE), and the copyright and trademark notice is in [NOTICE](NOTICE).

You may use, modify, and distribute the project, including commercially, provided you keep the copyright and license notices and include the statements in [NOTICE](NOTICE) with any distribution. Apache 2.0 grants a license to the source code only; it does not grant a trademark license for the name “Tree-thinking”. Do not use the name to imply official endorsement or affiliation without written permission.

## Changelog

Versioning: each conversation iteration bumps one minor version (0.1.x) unless a specific target version is requested.

### 0.3.14 — 2026-11-23
- Added: in-canvas search. `Ctrl/Cmd + F` opens a frosted search panel at the top of the canvas, scoped to the current canvas's card titles and bodies (including notes); results show matching snippets with highlighted keywords, the input grows with its content, and the panel can be resized from its bottom-right corner with the size stored locally.
- Added: a global search box at the top of the sidebar that searches canvas names, card titles, and bodies across all canvases; the result popover spans the sidebar width and labels the owning canvas and field type.
- Added: backend `GET /api/search` (`q` plus optional `project_id`) with case-insensitive substring matching and snippets around each hit, capped at 60 items per request; in server mode it only searches the signed-in user's canvases, and in-canvas search additionally narrows to the open canvas.
- Added: focus behavior after clicking a result. The camera aims at the matched keyword inside the card: in-canvas search keeps the current zoom on a single click and only restores the zoom to 100% when the same result is clicked again quickly (within the configured double-click interval), while sidebar search switches the canvas, moves the camera, and fits a suitable zoom to the viewport.
- Added: matched content is highlighted and smoothly flashes inside the card (ease-in-out fade, 0.7s per pulse, five pulses; titles, answers, and note bodies are supported while code blocks and math are left untouched). In-canvas search keeps the highlight after flashing, sidebar search flashes only and then returns the text to normal, and jumping to a new result clears the previous highlight.
- Version: bumped to 0.3.14.

### 0.3.13 — 2026-11-22
- Improved: pasting or typing a URL in any question input (root question, custom direction, branch input, prompt drawer) now moves the link out of the text into a numbered chip, so the box keeps only the body text; on submit the links are appended to the end of the question in chip order. Clicking a chip opens it in a new tab, double-clicking edits it inline (Enter saves, Esc cancels), and removing a chip drops that link.
- Improved: note cards now sit above the suggestion ghosts, so suggestion arrows and the custom-direction input no longer cover notes.
- Improved: clicking, dragging, or focusing a card counts as a state update and raises it above note cards; streaming cards are raised too, and with a multi-selection the most recently clicked card sits on top.
- Improved: removed Settings → Canvas → Pointer → Wheel logic; scrollable regions inside cards (answer body, Thinking block, note body) now always scroll their content with the wheel, and holding Space makes the wheel zoom the canvas.
- Docs: corrected the server deployment guides (Chinese and English) to match the current code — HTTPS section reference, Python 3.10+ / Node 20.19+, server mode ignoring `.env` model keys (each account configures its own in Settings), upgrade and 401 troubleshooting after the session-cookie rename, `backend/.env` (AUTH_SECRET) added to the backup scope, OpenAI-compatible egress, and provider ownership of document parsing and web search.
- Version: bumped to 0.3.13.
- readme: rewritten the introduction part.
- 0.3.13 hotfix1: Fixed: in server mode, a failed session request on first load (backend down, 502, `/api` not reverse-proxied) was treated as local mode and went straight to the canvas, bypassing the login page; the app now shows a “cannot reach the backend” retry screen instead of rendering the canvas, and non-JSON `/api` responses report a proxy configuration hint.



### 0.3.12 — 2026-11-22
- Added: server-mode registration now validates that the username is well-formed and not taken; a public read-only `GET /api/auth/check-username` endpoint backs the in-form check, and the registration endpoint still performs the final validation.
- Added: a “Restore defaults” button at the bottom-left of the settings dialog resets every setting while keeping saved API keys; in server mode it only affects the current account.
- Improved: server-mode passwords are now 4–12 characters; the username, password, and confirm-password fields validate on blur, show the reason below the field, and highlight the invalid border.
- Improved: the server-mode model search limit now defaults to 50 (legacy 0 is treated as 50) and is clamped to 1–50.
- Improved: settings key hints now read “the key is stored only in the backend and never written to the browser”.
- Fixed: a new account showing a masked API key by default — in server mode `settings.effective()` no longer falls back to model keys from `backend/.env` and `llm._resolve()` respects an explicitly empty runtime key; registration creates an empty per-user settings row, accounts use hard-coded defaults, and neither accounts nor `.env` share keys any more.
- Notes: the session cookie is renamed to `tt_session_server` to isolate same-host instances on different ports; existing sessions become invalid after upgrading and require signing in again.
- Notes: browser storage never contains plaintext API keys or settings — only the “development notice seen” flag; the settings API returns masked keys only. The README adds “Key and settings boundaries” and “What is uploaded and what is not”.
- Docs: updated the README, deployment guides, and development conventions (account rules, settings isolation, restore defaults, data egress boundaries).
- Version: bumped to 0.3.12.

### 0.3.11 — 2026-11-22
- Added: after the first login in server mode, an in-app “under development” notice appears once per account per browser; local mode never shows it.
- Fixed: `start.sh` still told users Node.js 18+ was enough; it now says 20.19+, as required by Vite 8.
- Docs: the README now marks the project as WIP, macOS as experimental, and Linux as verified for server deployment at the top, and corrects statements that no longer matched the code (Node 20.19+, `APP_MODE` and server login, DeepSeek-only auto titles, forced-search limit 1–50 with default 50, attachment preview and warning placement, config table, security section, project layout, and tech stack).
- Version: bumped to 0.3.11.

### 0.3.10 — 2026-11-21
- Improved: attachment chips are slightly larger and scale with the card font size; title icon buttons, “Thinking process”, footer actions, stop / retry / pause controls, input toolbars, and note-card buttons also scale proportionally. When attachments are collapsed, hovering only the “Attachments N” entry or the popup expands it, and the pointer can move into the popup without it closing.
- Added: every attachment chip can be left-clicked to open the original file — PDFs and images open as an inline preview in a new browser tab (`Content-Disposition: inline`), other types are opened or downloaded by the system.
- Added: empty-answer fallback — when a card shows “暂无回答”, hovering the card shows an accent-colored “重新提交” button in the center that re-requests the current question.
- Improved: very large PDF attachments (many pages) warn “pdf页数过多，可能超出模型上下文”; context-overflow errors are translated into Chinese with advice to remove attachments / history or switch to a model with a larger context window.
- Improved: the “My prompt” drawer no longer scrolls in read or edit mode; content grows upward while the bottom edge stays fixed.
- Improved: PDF page / model capability warnings now sit to the left of the submit button.
- Improved: note-link dots scale with the card font size, link anchors use the same scale, and the error box leaves room for the dot on its right.
- Improved: card and canvas dragging now follow the pointer directly; the smoothing interpolation for node and trackpad panning was removed to eliminate damping.
- Fixed: suggested follow-ups no longer leak truncated JSON fragments (e.g. `{"suggestions":[{"te`) as directions; invalid fragments are filtered and complete `text` fields are salvaged when possible.
- Docs: added the “card font scaling” and “changelog writing” conventions to the development guide.
- Version: bumped to 0.3.10.

### 0.3.9 — 2026-11-20
- Added: the Volcengine Ark (`ark`) provider — the API key is encrypted at rest, the base URL (default `https://ark.cn-beijing.volces.com/api/v3`) and model name (default `doubao-seed-2-1-pro-260915`) are configurable, and streaming answers, deep thinking, and smart web search are supported.
- Improved: provider dropdown order is fixed to DeepSeek → Volcengine Ark → OpenAI-compatible (OpenAI-compatible always last).
- Improved: Ark model candidates are loaded from the Ark Models API for every model visible to the account; only text-output LLMs are listed (image / video / 3D generation models and `seed-character` excluded), shown with readable names and sorted alphabetically; without a key or when the API fails it falls back to built-in LLM candidates, and manual input still works.
- Added: model capability hints based on `input_modalities` (“this model does not support image / video / audio / may not support PDF document understanding”), shown next to the PDF page warning; attachments that failed to parse show a warning icon on the chip.
- Added: attachment input covers images, text, PDF, video, audio, and other files; Ark uploads through the Files API (`purpose=user_data`) and injects `fileId`, DeepSeek keeps its existing document parsing, and OpenAI-compatible providers keep images / text.
- Added: the PDF page-count warning — the attachment DTO returns `pageCount`; when any PDF exceeds 30 pages or the total exceeds 30, all four input locations warn “pdf页数过多，费用可能失控”.
- Improved: Ark web search only shows the `sources` list and never inserts `[n]` badges into the answer; DeepSeek keeps precise citation badges.
- Improved: forced search is DeepSeek-only; Ark falls back to smart search and hides the forced-search switch; session titles are DeepSeek-only.
- Notes: when Ark web search returns 403, enable the “Doubao Search Custom” component in the Ark console; the error message is shown verbatim.
- Notes: Ark files are stored for 7 days by default (configurable 1–30 days); `fileId` values may become invalid after changing the key or account and must be re-uploaded.
- Improved: model selection uses one shared interaction — a text input with a scrollable frosted-glass candidate popup; focusing clears the field to show every candidate, blur restores or keeps the choice; DeepSeek and Volcengine Ark provide candidates, the OpenAI-compatible provider has none and takes whatever model name the service requires.
- Improved: all dropdowns use the same frosted-glass popup; the visible item count is configurable (9 by default), native `<select>` / `datalist` are no longer used, and the settings control column is 380px (max 46%).
- Fixed: the Deep Thinking toggle was incorrectly disabled for Volcengine Ark; it now works exactly as it does for DeepSeek.
- Docs: added Ark adaptation, file input, and source-display conventions to the development guide, plus the “model picker input” and “dropdown” conventions; Ark environment variables and outbound-network notes were added to the deployment guide.
- Version: bumped to 0.3.9.

### 0.3.8 — 2026-11-20
- Rewrote trackpad gestures: a two-finger swipe pans the canvas and a pinch zooms it; pinch also works over scrollable card content and zooms around the pointer; while Space is held, a two-finger swipe pans the canvas (matching Space + left drag), and pinch and mouse wheel still zoom.
- Fixed fast vertical trackpad swipes being mistaken for mouse-wheel input and triggering zoom: mouse wheels are now detected by full-notch steps, and high-frequency follow-up events correct a misclassified first event.
- Added Settings → Canvas → Pointer → Pointer device with "Mouse" / "Trackpad (experimental)", defaulting to Mouse; only trackpad mode enables the two-finger gesture routing, interpolation, and inertia, while mouse mode keeps standard wheel behavior.
- Improved: wheel handling now uses a continuous gesture session, so moving the pointer over cards or suggestions mid-swipe no longer switches to zoom or scrolling.
- Improved: trackpad pan and pinch now interpolate toward the target every frame, so short swipes stay smooth and direction changes follow on the next frame; whether the canvas glides after release follows Settings → Display → Canvas drag inertia.
- Improved: pinch zoom is more responsive (zoom curve factor raised from 0.002 to 0.01).
- Improved: the "My question" drawer now uses a frosted-glass background.
- Improved: the "Stop generating" button now keeps the same clearance from the note-link dot as the done-state toolbar.
- Docs: added trackpad gesture notes to the development guide.
- Bumped the version to 0.3.8.

### 0.3.7 — 2026-11-19
- Rewrote the Windows launcher `start.bat`: all messages are now plain ASCII English, eliminating garbled Chinese output and broken commands caused by different Windows code pages.
- Stronger one-click setup: the first run creates the backend venv, installs backend/frontend dependencies, and prepares `.env`; every run verifies dependencies.
- Startup order: the backend starts first and waits for `/health`, then the frontend starts, reducing Vite proxy connection-refused errors.
- Clear installation hints when Python or Node.js is missing.
- Added: inline citation badges for smart search. The backend converts `annotations` positions into `[n]` badges, matching forced-search display; the converted text is persisted so badges survive reopening the canvas.
- Improved: the final answer is delivered in the `done` event, so badges appear as soon as streaming finishes.
- Docs: added a “search results and citation badges” convention so future providers follow the same scheme.
- Added: question inputs detect links and show numbered frosted-glass chips below the input; hovering the × highlights it, and clicking removes that link from the prompt.
- Improved: when the current prompt contains links, smart search declares only `deepseek_read_url` to read them and injects a “link 1 / link 2 …” mapping; input-link numbers and citation badge numbers are independent.
- Docs: added link detection, numbering, and read-link conventions to the development docs.
- Bumped the version to 0.3.7.

### 0.3.6 — 2026-11-18
- Fixed: holding Space and scrolling inside `.nowheel` areas such as “My prompt” could not zoom the canvas; Space now takes priority for zooming, while normal scrolling keeps the area's native behavior.
- Fixed: a newly created branch card could cover another card's suggestions / custom-direction area; overlap with those areas is now detected after creating a branch and triggers one auto-layout when needed.
- Improved: auto-layout avoidance now matches the actual suggestion visibility rules, including the default expanded custom-direction input when there are no suggestions.
- Fixed: links between answer cards and note cards were lost after switching canvases; the graph endpoint now returns them, and exported files include them too.
- 0.3.6 hotfix1: removed the automatic save before switching to or creating another canvas, restoring the previous switching behavior.
- Bumped the version to 0.3.6.

### 0.3.5 — 2026-11-18
- Added: a color setting for note-card links (Settings → Canvas → Note cards); link style and width also appear under Settings → Appearance → Edges and stay in sync.
- Improved: link dots always use the accent border and become solid when dragging a link; snapping now covers the whole target card, not just the dot.
- Improved: when a note card overlaps the custom-direction or branch input, the focused input is raised above the note card.
- Improved: all translucent inputs and panels share a frosted-glass material; links always render beneath cards.
- Improved: the “Re-enter prompt / New branch” buttons shift left to leave room for the link dot.
- Fixed: deleting a hovered link with Delete failed.
- Improved: the maximum width for every link type is now 12.
- Added: dragging a link onto an already-connected pair now disconnects it.
- Improved: the maximum canvas zoom is now 500%.
- Improved: suggestions render above note cards, while the focused input stays on top.
- Improved: every popup on the canvas except the cards themselves (toolbar buttons, suggestions, custom direction, branch input, attachment bar, “My prompt”, sources drawer, etc.) uses frosted glass; the sources drawer uses a more transparent tier.
- Improved: “My prompt” leaves edit mode and returns to read-only when it loses focus.
- Improved: card dragging follows the display refresh rate, and frosted glass is temporarily disabled during drags for smoother motion.
- Docs: added a glossary, layering rules, and frosted-glass conventions to the development docs.
- Bumped the version to 0.3.5.

### 0.3.4 — 2026-11-17
- Added: links between answer cards and note cards. Each answer card has a link dot at the right of its bottom toolbar, and each note card has one at the left of its title; drag from either end to connect. While dragging, the preview line is highlighted, connectable dots light up, other links dim, and nearby dots snap.
- Added: links are saved with the canvas, included in export/import, and undoable; hover a link and press `Delete` to remove it.
- Added: Settings → Canvas → Note cards: link style (curved / orthogonal, default orthogonal), link width (default 1.5, same range as the regular edges), and release action (none / hold Shift to create a blank note / create a blank note).
- Improved: dragging an answer card moves its linked note cards together; a note shared by several answer cards follows only when all of its parents move together; auto-layout shifts notes with their parents to keep relative positions.
- Bumped the version to 0.3.4.

### 0.3.3 — 2026-11-16
- Fixed: the model still returned reasoning after “Deep thinking” was turned off. DeepSeek enables thinking by default, and the previous request sent no parameter when disabled, so the server kept the default. The request now explicitly sends `{"thinking": {"type": "disabled"}}`, with a regression test added.
- Bumped the version to 0.3.3.

### 0.3.1 — 2026-11-15
- Added: session titles — when the root card answers for the first time, DeepSeek generates the canvas title within the answer stream (no extra billing, no separate model request); a manual canvas rename is kept.
- Added: document parsing — PDF, Word (DOC/DOCX), and PowerPoint (PPT/PPTX) attachments are parsed by the backend through the DeepSeek Files API (`text_recognition`), so the model can answer from their content; a parsing failure does not affect attachment storage.
- Added: search modes — smart search (default) lets the model decide whether to go online, using DeepSeek's server-side web tool; forced search keeps the previous retrieve-then-answer flow and caps sources via “Forced search limit” (1–50). Choose one under Settings → Model service → DeepSeek options, or toggle forced search in the panel that appears when hovering the “Web search” button in the canvas toolbar; both stay in sync and persist, with forced search off by default. Answers that used the web tool in smart mode cannot “Continue generating” — the paused state disables that button and suggests “Re-enter prompt” instead.
- Bumped the version to 0.3.1.

### 0.3.0 — 2026-11-15
- Fixed: answer bodies failed to scroll on macOS Chrome, including a broken scrollbar.
- Added: stop-generating now has three states — with no output the card is deleted (the root card returns to input mode); with partial output the card pauses behind frosted glass and offers “Continue generating” and “Re-enter prompt”; the backend adds a continuation endpoint.
- Added: when there are no suggestions, the custom-direction input appears expanded by default and collapses on blur; fixed it being prefilled with a deleted card's content after stop-generating removed that card.
- Improved: card titles are clamped to two lines with an ellipsis, and refresh automatically after a resubmit (manual renames are kept).
- Improved: note cards now stack above suggestions.
- Fixed: jitter when zooming with the wheel while left-dragging the canvas; both now work at the same time.
- Improved: the model search limit now accepts 1–50 (a legacy 0 is shown and saved as 50).
- Added: server deployment mode `APP_MODE=local|server` — multi-user sign-up / sign-in / sign-out, bcrypt password hashing, HttpOnly session cookies, per-user isolation of canvases / nodes / attachments / settings, and Fernet-encrypted API keys; local mode still needs no login.
- Added: the sidebar download button exports a canvas history file, and dropping a JSON file imports it and switches to that canvas automatically.
- Docs: added bilingual deployment guides `docs/deploy.md` and `docs/deploy_en.md`.
- Bumped the version to 0.3.0.

### 0.2.4 — 2026-11-13
- Added: a “View my prompt” icon in the card title bar opens a drawer from the card top showing the user's original prompt; double-click to edit in a composer matching “custom direction”, with the circular button meaning “Resubmit”.
- Added: the backend now stores the original prompt in a `prompt` field, so renaming the title, regenerating, and copying no longer affect it.
- Improved: “Regenerate answer” checks for downstream cards and asks “重新生成将会丢失后续卡片内容，请问是否继续？”; confirming deletes those branches and resubmits, and the whole step is undoable.
- Improved: the card's “换一个方向” action is now “重新提问” and opens the same prompt drawer.
- Added: a “Stop generating” button appears while streaming; it aborts the request immediately. The root card returns to input mode with its prompt prefilled, while other cards are deleted and their input stage is restored.
- Improved: the “New branch” input now matches the “custom direction” composer (attachments, thinking, web search, send) and plays a collapse animation when it loses focus.
- Added: pasting images uploads them as attachments; pasting text longer than 2000 characters is converted into a `.txt` attachment.
- Fixed: “Copy question and answer” now copies the original prompt plus the plain answer instead of the renamed title.
- Bumped the version to 0.2.4.

### 0.2.3 — 2026-11-13
- Added: math rendering in answers via KaTeX, supporting `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`; long display equations scroll horizontally inside the card, and citation badges plus code blocks are unaffected.
- Added: a “Deep thinking” toggle in the canvas toolbar between Auto layout and Web search, synced with the thinking-mode option under Settings → Model service and the shortcut in card inputs (including the custom-direction composer); hovering shows “仅支持 DeepSeek API” on other providers.
- Bumped the version to 0.2.3.

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
