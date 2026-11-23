# Feature Reference

This document supplements the [README](../readme_en.md) with the complete list of current features and behaviors. For deployment, see [deploy_en.md](deploy_en.md); for development conventions, see [development.md](development.md).

## Canvas

- **Infinite canvas, growing left to right**: every follow-up creates a new card on the right; the canvas pans and zooms without bounds.
- **Panning**: Space + left drag, middle-button drag, or press-and-drag on empty space (drift delay and distance configurable). While Space is held, dragging anywhere — card text, titles, attachments, or an unfocused input — pans the canvas.
- **Zooming**: the wheel scrolls content inside scrollable card regions (answer body, Thinking block, note body) and zooms the canvas elsewhere; holding Space always zooms.
- **Trackpad (experimental)**: switch Pointer device to “Trackpad” in Settings to pan with two-finger swipes and zoom with pinches; holding Space also pans with two fingers.
- **Card sizes**: chat cards share one global size, adjustable from all four edges and corners (minimum 280×240); note cards keep their own size. Cards grow automatically when the font size increases.
- **Drag and pin**: any blank area of a card can be dragged; pinned cards cannot be dragged directly (the root card is pinned by default), and dragging moves the whole subtree.
- **Multi-select and snapping**: Ctrl-click to multi-select and batch delete; hold Shift to snap to a 20px grid and nearby cards.
- **Undo and save**: each canvas keeps its own multi-step undo stack (Ctrl+Z, depth configurable, including card-size changes); Ctrl+S saves manually and autosave runs on the configured interval; saving never clears undo history.
- **Auto layout**: the root card keeps its position and the main chain stays on one horizontal line; direct branches sit below their parent in the same column, while bus branches sit in the next column and share one bus. Row and column spacing are configurable.
- **Dynamic layering**: clicking, dragging, or focusing a card counts as a state update and raises it above note cards; streaming cards are raised too. When nothing is focused, notes sit above suggestion ghosts and idle chat cards stay at the bottom. Edges always render beneath cards.
- **Canvas style**: solid or dotted background; pan inertia can be enabled with an adjustable coefficient.

## Search

- **In-canvas search**: `Ctrl/Cmd + F` opens a frosted search panel at the top of the canvas and searches only the current canvas's card titles and bodies (including notes). Results show snippets around each hit with highlighted keywords. A single click aims the camera at the matched keyword inside the card (keeping the current zoom), and the hit is highlighted and smoothly flashes for about 3.5 seconds, then keeps the highlight background to show its position; body hits also scroll the card internally to the match. Clicking the same result again quickly (within the configured double-click interval) restores the zoom to 100%, while an already larger zoom is kept. The panel can be resized from its bottom-right corner, and the size is stored in the browser and restored next time.
- **Global search**: the search box at the top of the sidebar searches canvas names, card titles, and bodies across all canvases. The result popover spans the sidebar width and labels the owning canvas and field type; clicking a hit switches to that canvas, moves the camera, fits a suitable zoom to the viewport, and highlights and flashes the matched content; once the flashing ends the text returns to normal, so no highlight is kept on the card.
- **Matching scope**: case-insensitive substring matching; in server mode only the signed-in account's canvases are returned, and in-canvas search additionally narrows to the open canvas. A single request returns at most 60 items and marks the list as truncated when more exist.

## Chat cards

- **One question, one answer**: each card stores a question and an answer. Answers render as Markdown with tables, code blocks, and math, and scroll inside the card when long.
- **Suggestions**: after an answer completes, candidate follow-ups (3 by default, 2–6 configurable) plus one “custom direction” input appear on the right. Only one can be picked per round; “another direction” generates a new round.
- **Branch input**: a full-width input bar below a card wraps and grows with long text; press Enter to submit.
- **Isolated context**: a request only contains the Q&A on the root-to-current path; sibling branches never see each other.
- **Thinking block**: with thinking mode enabled, the “Thinking” section is collapsed by default and expands on click; reasoning is never sent to later turns.
- **Answer actions**: stop, continue from the breakpoint, regenerate, and copy question plus answer; an empty answer shows a centered “resubmit” action.
- **Titles**: double-click a title to edit it (Enter or blur commits, Esc cancels). With DeepSeek, the root card's first answer generates a canvas title, and a manual rename is never overwritten.
- **Modified time**: chat and note cards show the last modified time at the bottom-right, in 12/24-hour format.

## Notes and links

- **Create notes**: double-click empty canvas to create a note; double-click its title or body to edit (single click is reserved for dragging and selection), and press Tab in the body editor to insert four spaces.
- **Note size**: drag any edge or corner to resize, independently of chat cards.
- **Note links**: an answer card has a link dot at the bottom and a note at the left of its title; drag from either end to create an undirected association, and the preview snaps when the pointer is inside the target card or near its dot.
- **Link appearance**: curved or orthogonal style, width, and color are configurable; hovering highlights the link and Delete removes it.
- **Release action**: when a drag from an answer card misses a note, Settings decides whether to do nothing, create a blank note with Shift, or always create one.

## Input and attachments

- **Four input places**: the root question card, the custom-direction input, the branch input bar, and the card's “my question” drawer behave the same.
- **Uploads**: click the paperclip or drag files in; images, text, PDF, video, audio, and other files are supported. Each file is limited to 20MB and each node to 10 attachments.
- **Attachment chips**: cards show a file icon and name at the top-left; more than three collapse into “附件 N”. Clicking an item opens the original file, with PDFs and images previewed in the browser.
- **Paste**: files pasted from the file manager become attachments; plain text longer than 2000 characters becomes a `.txt` attachment.
- **PDF warnings**: when any PDF exceeds 30 pages or the total exceeds 30, the submit button's left side warns about possible cost; beyond 100 pages it warns about the context limit.
- **Document parsing**: DeepSeek uploads PDF / Office files to its Files API; Volcengine Ark uploads images / video / audio / PDF to the Ark Files API; OpenAI-compatible providers keep images and text.
- **Link detection**: typing or pasting a URL moves it out of the text into a numbered chip below the input, leaving only the body text. Clicking a chip opens it in a new tab, double-clicking edits it inline (Enter saves, Esc cancels), and × removes it. On submit, links are appended to the end of the question in chip order, up to 10.

## Models and web search

- **Providers**: DeepSeek (default), Volcengine Ark, and OpenAI-compatible; each keeps its own key, base URL, and model.
- **DeepSeek**: supports `deepseek-flash` / `deepseek-v4-pro`; thinking mode is switchable, and forced-search material count is configurable from 1 to 50 (default 50).
- **Volcengine Ark**: takes an API key, base URL, and model name; supports streaming answers, deep thinking, and smart web search. Model candidates come from the Ark Models API and only include text-output LLMs.
- **OpenAI-compatible**: works with any service implementing the OpenAI protocol, with organization / project, temperature, max output tokens, reasoning effort, and request timeout.
- **Web search**: one switch at the canvas top-left and one in the input area; when enabled the app searches before answering, and cards show “参考 N 篇资料” that opens a source drawer from the card bottom.
- **Citation badges**: DeepSeek renders `[n]` in answers as clickable source badges; Volcengine Ark only lists sources and never inserts badges.
- **Session titles**: only DeepSeek generates a canvas title from the root card's first answer.

## Settings

- **Three tabs**: Model service / Canvas / Appearance; changes apply immediately without a restart.
- **Interaction**: section headings with a description on the left and the control on the right; bounded values use a slider plus a number input and are corrected on blur.
- **Restore defaults**: the bottom-left button resets every setting while keeping saved API keys; in server mode it affects only the current account.
- **Main settings**:
  - Model service: provider, API key, base URL, model, thinking mode, suggestion count, search mode and limit;
  - Canvas: connection style, card spacing, pan inertia, canvas style, trackpad logic, double-click interval, pointer drift delay and distance, autosave interval, undo depth;
  - Appearance: theme mode, font size, accent hue, edge width and color, note-link style / width / color / release action, time format.

## Accounts and data

- **Local mode**: the default `APP_MODE=local` is single-user with no login; settings live in the local database, and model keys come from the in-app settings or fall back to `backend/.env`.
- **Server mode**: with `APP_MODE=server`, registration and sign-in are required, and canvases, nodes, attachments, settings, and API keys are isolated per account. A new account starts with all defaults and no key, and never inherits model keys from `.env`.
- **Account rules**: usernames are 3–32 letters, digits, or underscores and must be unique; passwords are 4–12 characters; the registration form validates on blur.
- **Key protection**: model keys are encrypted at rest in the backend database; the API returns only masked values (e.g. `sk-••••7890`) and never writes them to browser storage.
- **Persistence**: canvases, nodes, positions, viewport, notes, and links are stored in SQLite and restored after refresh.
- **Export and import**: a canvas can be exported as JSON and imported again, including nodes, viewport, and note links.
- **Data egress boundaries**: answering, web search, and document parsing send the current branch's Q&A and selected attachments to the active provider; other accounts' data and unselected providers' keys and configuration are never sent. See “Outbound network and data egress” in [deploy_en.md](deploy_en.md) for the full list.

## Shortcuts

| Key | Action |
| --- | --- |
| `Space` + left drag | Pan the canvas |
| Middle-button drag | Pan the canvas |
| Wheel | Scroll scrollable card regions, zoom the canvas elsewhere; holding Space zooms |
| `Esc` | Close overlays and drawers in last-opened-first-closed order |
| `Tab` (note body editing) | Insert four spaces |
| `Delete` | Delete selected cards (the root card excluded) |
| `Ctrl/Cmd + F` | Open / focus in-canvas search |
| `Ctrl/Cmd + Z` | Undo the last action on the current canvas |
| `Ctrl/Cmd + S` | Save the current canvas |
