# Assembly Lime UI Redesign Plan

## Goals

1. **Faster navigation** - Cmd+K command palette, keyboard shortcuts everywhere
2. **Better information density** - Show more data without clutter using color restraint and precise spacing
3. **Improved Command Center** - Split-pane chat + artifact viewer like Claude/Cursor
4. **Observable agent execution** - Hierarchical trace view instead of flat event log
5. **Consistent page patterns** - Every management page uses the same table/filter/drawer pattern
6. **Polished dark theme** - Refined color system, better typography, skeleton loading

---

## Phase 1: Foundation & Navigation (High Impact, Low Risk)

### 1.1 Command Palette (Cmd+K)

**What:** Global search and action bar accessible from any page.

**Current state:** No global search. Users must click through sidebar to navigate.

**Design:**
- Trigger: `Cmd+K` (Mac) / `Ctrl+K` (Windows)
- Centered modal overlay with search input and grouped results
- Groups: **Navigation** (pages), **Actions** (create ticket, run agent, reindex), **Recent** (last 5 visited pages/runs), **Search** (tickets, repos, agent runs by name/ID)
- Keyboard nav: Arrow keys to select, Enter to execute, Escape to close, Tab to switch groups
- Fuzzy matching on all searchable entities
- Result types with icons: page (layout icon), ticket (checkbox), repo (git-branch), agent run (play), action (zap)

**Files to create:**
- `apps/web/src/components/CommandPalette.tsx` - modal + search logic
- `apps/web/src/hooks/useCommandPalette.ts` - registration of commands, keyboard listener
- `apps/web/src/components/layout/AppLayout.tsx` - mount CommandPalette

**Implementation notes:**
- Use Radix `Dialog` for the overlay
- Debounce search input at 150ms
- API endpoint: `GET /search?q=...&types=ticket,repo,run` (or client-side filter for navigation/actions)
- Store recent items in localStorage
- Each result item shows: icon + title + subtitle (e.g., repo name, status) + keyboard hint

---

### 1.2 Sidebar Redesign

**What:** Collapsible sidebar with grouped sections, active run badges, and improved hierarchy.

**Current state:** Flat list of 10 nav items, all equal weight. No section grouping. No collapse. Project switcher at bottom is easy to miss.

**Design:**
```
[Logo]  Assembly Lime         [<<] collapse button

WORKSPACE
  Command Center    [3] ← active runs count
  Board
  Agent Runs

CODE
  Repositories
  Dependencies
  Code Search

INFRASTRUCTURE
  Connectors
  Clusters
  Sandboxes
  Domains

─────────────────
[Project switcher]  ▲
  Acme Corp / Project Alpha
```

**Changes:**
- Add section headers ("WORKSPACE", "CODE", "INFRASTRUCTURE") as 10px uppercase zinc-600 labels
- Move project switcher to TOP of sidebar (below logo), not bottom
- Add collapse toggle → icon-only rail (48px wide) with tooltips
- Show active agent run count badge on "Agent Runs" nav item (poll `/agent-runs?status=running&count=true` or derive from existing data)
- Persist collapsed state in localStorage
- Collapse automatically on screens < 1024px wide

**Files to edit:**
- `apps/web/src/components/layout/Sidebar.tsx` - restructure nav, add collapse
- `apps/web/src/components/layout/AppLayout.tsx` - handle collapsed sidebar width

---

### 1.3 Keyboard Shortcuts

**What:** Keyboard shortcuts for common actions with discoverable hints.

**Shortcuts map:**
| Key | Action | Scope |
|-----|--------|-------|
| `Cmd+K` | Open command palette | Global |
| `G then C` | Go to Command Center | Global |
| `G then B` | Go to Board | Global |
| `G then R` | Go to Agent Runs | Global |
| `G then S` | Go to Code Search | Global |
| `N` | New ticket (on Board page) | Board |
| `Enter` | Open selected item | Lists/tables |
| `Escape` | Close drawer/modal/palette | Global |
| `?` | Show keyboard shortcut help | Global |

**Files to create:**
- `apps/web/src/hooks/useKeyboardShortcuts.ts` - global listener + registration
- `apps/web/src/components/KeyboardShortcutHelp.tsx` - help modal triggered by `?`

**Implementation notes:**
- Use a `go-to` two-key sequence pattern (press G, then next key within 1s)
- Show shortcut hints in command palette results and on hover (after 1s delay) via tooltips
- Respect focus: don't trigger when typing in inputs/textareas

---

### 1.4 Breadcrumb Navigation

**What:** Breadcrumbs on detail pages to show hierarchy and enable quick back-navigation.

**Current state:** No breadcrumbs. Users must use browser back or sidebar to return to list views.

**Design:**
- Show on all detail/nested pages: `Repositories > acme/backend`, `Agent Runs > Run #142`, `Board > Ticket AL-34`
- Clickable segments that navigate to parent pages
- Current page segment is non-clickable, muted color

**Files to create:**
- `apps/web/src/components/ui/Breadcrumbs.tsx`
- Edit `apps/web/src/components/layout/TopBar.tsx` - replace static title with breadcrumbs

---

## Phase 2: Command Center Overhaul (Highest Impact)

### 2.1 Split-Pane Layout (Chat + Artifacts)

**What:** Resizable two-panel layout. Left: conversation/transcript. Right: contextual artifact viewer.

**Current state:** Single-column layout. Transcript is a vertical scroll of event cards. Diffs, tasks, and artifacts are inline in the scroll - easy to lose context.

**Design:**
```
┌──────────────────────────┬────────────────────────────┐
│  TRANSCRIPT              │  ARTIFACT VIEWER           │
│                          │                            │
│  [User prompt]           │  [Tabs: Diff | Tasks |     │
│  [Agent message...]      │   PR | Terminal | Preview] │
│  [Tool call ▶]           │                            │
│  [Agent message...]      │  (shows selected artifact  │
│  [Diff produced ●]  ←────│── clicking opens here)     │
│                          │                            │
│  ┌──────────────────┐    │                            │
│  │ prompt input     │    │                            │
│  │          [Send]  │    │                            │
│  └──────────────────┘    │                            │
└──────────────────────────┴────────────────────────────┘
         ↕ drag to resize
```

**Key behaviors:**
- Default split: 55% transcript / 45% artifacts
- Artifact panel starts collapsed (empty state: "Artifacts will appear here")
- When first artifact is produced, panel auto-opens with a smooth animation
- Clicking an artifact reference in the transcript selects it in the artifact panel
- Artifact tabs: **Diff** (syntax-highlighted unified diff), **Tasks** (checklist from plan), **PR** (rich card with link), **Terminal** (sandbox output), **Preview** (iframe or screenshot)
- Panel remembers user's resize position in localStorage
- On narrow screens (<1024px), artifacts show as a bottom sheet instead of side panel

**Files to create:**
- `apps/web/src/components/command-center/SplitPane.tsx` - resizable container (use CSS resize or a thin library like `allotment`)
- `apps/web/src/components/command-center/ArtifactPanel.tsx` - tabbed artifact viewer
- `apps/web/src/components/command-center/ArtifactTab.tsx` - individual tab content renderers

**Files to edit:**
- `apps/web/src/pages/CommandCenterPage.tsx` - wrap in SplitPane
- `apps/web/src/components/command-center/TranscriptPanel.tsx` - emit artifact selection events instead of inline rendering

---

### 2.2 Collapsible Tool Calls

**What:** Agent tool calls render as compact collapsible blocks with status indicators.

**Current state:** Tool calls render as full expandable sections with wrench icon. They take significant vertical space even when collapsed.

**Design:**
```
  ┌─ 🔧 exec("git diff HEAD~1") ─── 1.2s ── ✓ ──── [▶] ─┐
  │  (collapsed by default - click ▶ to expand)            │
  └────────────────────────────────────────────────────────┘

  Expanded:
  ┌─ 🔧 exec("git diff HEAD~1") ─── 1.2s ── ✓ ──── [▼] ─┐
  │  diff --git a/src/auth.ts b/src/auth.ts                │
  │  --- a/src/auth.ts                                      │
  │  +++ b/src/auth.ts                                      │
  │  @@ -42,3 +42,7 @@                                     │
  │  ...                                                    │
  └────────────────────────────────────────────────────────┘

  Running:
  ┌─ 🔧 exec("bun test") ─── ⏳ running... ───────────────┐
  └────────────────────────────────────────────────────────┘
```

**Changes:**
- Single-line collapsed view: tool icon + name + truncated args + duration + status icon
- Running state: animated spinner, elapsed time counter
- Success: green check, failure: red X
- Click to expand full input/output
- Multiple sequential tool calls group into a "N tool calls" collapsible block

**Files to edit:**
- `apps/web/src/components/command-center/EventGroupCard.tsx` - refactor tool_call rendering

---

### 2.3 Improved Prompt Input

**What:** Richer input area with mode selector chips, model dropdown, and slash commands.

**Current state:** Textarea + mode chips + provider/repo dropdowns. Functional but scattered across multiple rows.

**Design:**
```
┌─────────────────────────────────────────────────────────┐
│  Describe what you want the agent to do...              │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Plan] [Implement] [Bugfix] [Review]    Claude ▼  ⏎   │
└─────────────────────────────────────────────────────────┘
```

**Changes:**
- Mode chips and model selector move to a bottom toolbar inside the input container
- Repository selector becomes a mention-style inline picker: type `@repo-name` in the input
- Support `/` slash commands in the input for quick mode selection
- `Cmd+Enter` to send (show hint text)
- Input auto-grows vertically up to 200px, then scrolls

**Files to edit:**
- `apps/web/src/components/command-center/PromptPanel.tsx`

---

### 2.4 Agent Run Timeline

**What:** Visual timeline showing agent execution phases on the run detail page.

**Current state:** Run detail shows a header with metadata + a flat transcript panel.

**Design:**
```
Run #142 ── Plan ── acme/backend ── 3m 42s ── ✓ Completed

[Queued]──[Sandbox]──[Cloning]──[Executing]──[Committing]──[Push]──[Done]
  0s        4s         12s        14s-198s      200s         210s    222s
                                  ████████
                               (longest phase highlighted)
```

- Horizontal phase bar at the top of the run detail page
- Each phase is a segment with duration label
- Active phase pulses/animates
- Click a phase to scroll transcript to that section
- Failed phase shows red with error tooltip

**Files to create:**
- `apps/web/src/components/runs/RunTimeline.tsx`

**Files to edit:**
- `apps/web/src/pages/RunDetailPage.tsx` - add timeline above transcript

---

## Phase 3: Data Display Consistency (Medium Impact)

### 3.1 Unified Table Component

**What:** A reusable data table component used across all list pages.

**Current state:** Each page has its own bespoke table markup. AgentRunsPage, ReposPage, ConnectorsPage, etc. all have slightly different table styles, pagination, and interaction patterns.

**Design features:**
- Sortable columns (click header to toggle asc/desc)
- Sticky header on scroll
- Row hover → reveal action buttons (ghost buttons on the right)
- Consistent pagination (page numbers + prev/next, or "Load more")
- Filter bar with removable chips above the table
- Empty state slot
- Loading state: skeleton rows (3-5 shimmer rows)
- Responsive: on mobile, collapse to card list

**Files to create:**
- `apps/web/src/components/ui/DataTable.tsx` - generic table with column definitions
- `apps/web/src/components/ui/FilterBar.tsx` - horizontal filter chips
- `apps/web/src/components/ui/Skeleton.tsx` - shimmer loading placeholder

**Files to edit (adopt the component):**
- `apps/web/src/pages/AgentRunsPage.tsx`
- `apps/web/src/pages/ReposPage.tsx`
- `apps/web/src/pages/ConnectorsPage.tsx`
- `apps/web/src/pages/ClustersPage.tsx`
- `apps/web/src/pages/SandboxesPage.tsx`
- `apps/web/src/pages/DomainsPage.tsx`

---

### 3.2 Skeleton Loading States

**What:** Replace all "Loading..." text and spinners with skeleton shimmer placeholders that match the layout of the content being loaded.

**Current state:** Most pages show a centered spinner or "Loading..." text. The page "jumps" when content loads.

**Design:**
- Skeleton rows for tables (matching column widths)
- Skeleton cards for Kanban board
- Skeleton text lines for transcript messages
- Skeleton panels for detail pages
- Use `animate-pulse` on zinc-800 rectangles over zinc-900 backgrounds

**Files to create:**
- `apps/web/src/components/ui/Skeleton.tsx` - `Skeleton.Text`, `Skeleton.Row`, `Skeleton.Card`, `Skeleton.Block`

---

### 3.3 Toast Notifications

**What:** Non-blocking success/error/info notifications for user actions.

**Current state:** No toast system. Actions either silently succeed or show inline errors.

**Design:**
- Bottom-right stack of toasts
- Auto-dismiss after 4s (success) or 8s (error), manual dismiss via X
- Types: success (green left border), error (red), info (blue), warning (amber)
- Content: icon + title + optional description
- Max 3 visible toasts, oldest dismissed first

**Files to create:**
- `apps/web/src/components/ui/Toast.tsx` - toast component
- `apps/web/src/hooks/useToast.ts` - context + `toast()` function
- Mount toast container in `AppLayout.tsx`

**Usage across the app:**
- "Ticket created" after adding a ticket on the board
- "Agent run started" after dispatching from Command Center
- "Repository synced" after importing repos
- "Reindex triggered" after manual reindex in Code Search
- "Failed to connect" on API errors

---

### 3.4 Improved Empty States

**What:** Contextual, helpful empty states with illustrations and primary CTAs.

**Current state:** `EmptyState.tsx` exists but is generic. Some pages don't use it at all.

**Design per page:**
| Page | Empty State Message | CTA |
|------|-------------------|-----|
| Board | "No tickets yet" | "Create a ticket" or "Run a planning agent" |
| Agent Runs | "No agent runs yet" | "Go to Command Center" |
| Repos | "No repositories connected" | "Connect a GitHub connector" |
| Code Search | "No repositories indexed" | "Go to Repositories to enable indexing" |
| Connectors | "No connectors configured" | "Add a GitHub connector" |
| Clusters | "No clusters registered" | "Register a cluster" |
| Sandboxes | "No active sandboxes" | "Create a sandbox" |
| Domains | "No domains configured" | "Add a domain" |

- Each empty state includes: monochrome line-art icon (from Lucide), descriptive title, 1-line explanation, primary CTA button, optional secondary link to docs

---

## Phase 4: Visual Polish (Medium Impact)

### 4.1 Color System Refinement

**What:** Tighten the color palette for better contrast and brand identity.

**Current colors (approximate):**
- Background: `zinc-950` (#09090b)
- Surface: `zinc-900` (#18181b)
- Border: `zinc-800` (#27272a)
- Primary accent: `emerald-600` (#059669) / `emerald-400` (#34d399)

**Proposed refinement:**
- Keep the zinc scale as-is (it's solid)
- **Shift accent from emerald to lime** to match the "Lime" brand name
  - Primary: `lime-500` (#84cc16) for buttons, active states
  - Primary hover: `lime-400` (#a3e635)
  - Primary muted: `lime-500/10` for subtle backgrounds
- **Add AI/agent color**: `violet-400` (#a78bfa) for agent-related badges, tool call icons, and AI-generated content markers
- **Status colors** (unchanged, these are standard):
  - Success: green-500
  - Error: red-500
  - Warning: amber-500
  - Info: blue-500

**Files to edit:**
- All component files that reference `emerald-*` classes → replace with `lime-*`
- Or define CSS custom properties in `index.css` and use those

**Decision needed:** Whether to do a full emerald→lime swap or keep emerald. The brand name "Assembly Lime" strongly suggests lime green as the accent.

---

### 4.2 Typography Improvements

**What:** Add a monospace font for code/terminal content, standardize text sizes.

**Current state:** Default system font stack. No dedicated monospace font for code blocks. Inconsistent text sizes across pages.

**Changes:**
- Add `JetBrains Mono` or `Geist Mono` as the monospace font
- Apply to: code blocks in diffs, terminal output, file paths, commit SHAs, code search results
- Standardize a type scale:
  - `text-xs` (12px): metadata, timestamps, secondary labels
  - `text-sm` (14px): body text, table cells, nav items
  - `text-base` (16px): emphasis, card titles
  - `text-lg` (18px): section headings
  - `text-xl` (20px): page subtitles
  - `text-2xl` (24px): page titles

**Files to edit:**
- `apps/web/index.html` - add font link
- `apps/web/src/index.css` - define `font-mono` class
- `apps/web/src/components/ui/DiffViewer.tsx` - apply monospace
- `apps/web/src/components/code-search/SearchResultCard.tsx` - apply monospace
- `apps/web/src/components/command-center/EventGroupCard.tsx` - apply monospace to code/tool output

---

### 4.3 Micro-Interactions & Transitions

**What:** Add subtle animations for page transitions, panel open/close, and state changes.

**Changes:**
- **Page transitions**: Fade-in on route change (150ms opacity transition on `<Outlet>`)
- **Sidebar collapse**: Smooth width transition (200ms ease-out)
- **Drawer open/close**: Slide-in from right with backdrop fade (200ms)
- **Card hover**: Subtle lift effect (translate-y -1px + slight border-color change)
- **Toast enter/exit**: Slide-up + fade-in, slide-down + fade-out
- **Status badge pulse**: `animate-pulse` on "running" status badges
- **Skeleton shimmer**: Left-to-right gradient sweep animation

**Implementation:** Use Tailwind `transition-*` utilities and `@keyframes` in CSS. No animation library needed.

---

## Phase 5: Page-Specific Improvements (Lower Priority)

### 5.1 Board Page Enhancements

- Add WIP (work-in-progress) limits per column with visual warning when exceeded
- Add swimlane grouping option (by assignee, priority, or feature)
- Improve ticket drawer: add activity log tab, linked agent runs tab, show PR status
- Add quick-edit inline: click ticket title to edit in place
- Add column collapse (hide columns you don't need)

### 5.2 Repositories Page

- Add card view toggle (grid of repo cards vs table list)
- Show last agent run status per repo
- Show index status (for code search) inline
- Add "Run Agent" quick action per repo

### 5.3 Code Search Page

- Add `repo:`, `lang:`, `path:` filter syntax in the search input (parsed client-side into API params)
- Add file preview pane: clicking a result opens the full file with the match highlighted
- Group results by repository with collapsible sections
- Show "indexed N repos, M files" stats below search bar

### 5.4 Agent Runs Page

- Add filter chips: by status, mode, repository, date range
- Add bulk actions: cancel multiple queued runs
- Add cost column (from LLM call dumps)
- Add duration column with relative time ("2m ago")
- Clickable row → navigate to run detail (currently requires explicit link click)

---

## Phase 6: Advanced (Future)

### 6.1 Notification Center
- Bell icon in TopBar with dropdown
- Notifications for: agent run completed/failed, PR created, approval requested, ticket assigned
- Mark as read, mark all read
- Optional browser push notifications

### 6.2 Dashboard / Home Page
- Replace the current redirect-to-command-center with a dashboard
- Show: active agent runs, recent tickets, repo activity, cost summary
- Quick actions: "New agent run", "Create ticket", "Search code"

### 6.3 Dark/Light Theme Toggle
- Currently dark-only. Add light theme support with CSS custom properties
- Store preference in localStorage
- Use `prefers-color-scheme` media query as default

### 6.4 Mobile Responsive Overhaul
- Bottom tab bar on mobile instead of sidebar
- Touch-optimized card sizes (min 44px tap targets)
- Swipe gestures on Kanban cards
- Responsive split pane (stack vertically on mobile)

---

## Priority & Effort Matrix

| Phase | Items | Impact | Effort | Priority |
|-------|-------|--------|--------|----------|
| 1.1 | Command Palette | Very High | Medium | P0 |
| 1.2 | Sidebar Redesign | High | Low | P0 |
| 1.3 | Keyboard Shortcuts | High | Low | P0 |
| 1.4 | Breadcrumbs | Medium | Low | P1 |
| 2.1 | Split-Pane Command Center | Very High | High | P0 |
| 2.2 | Collapsible Tool Calls | High | Medium | P1 |
| 2.3 | Improved Prompt Input | Medium | Low | P1 |
| 2.4 | Agent Run Timeline | High | Medium | P1 |
| 3.1 | Unified Table Component | High | High | P1 |
| 3.2 | Skeleton Loading | Medium | Medium | P2 |
| 3.3 | Toast Notifications | Medium | Low | P1 |
| 3.4 | Improved Empty States | Low | Low | P2 |
| 4.1 | Color System (lime accent) | Medium | Medium | P2 |
| 4.2 | Typography | Medium | Low | P2 |
| 4.3 | Micro-Interactions | Low | Low | P2 |
| 5.x | Page-specific improvements | Medium | Medium | P2 |
| 6.x | Advanced features | Medium | High | P3 |

---

## Suggested Implementation Order

1. **Sprint 1 (Foundation):** Sidebar redesign (1.2) + Keyboard shortcuts (1.3) + Breadcrumbs (1.4) + Toast notifications (3.3)
2. **Sprint 2 (Command Center):** Split-pane layout (2.1) + Collapsible tool calls (2.2) + Improved prompt input (2.3)
3. **Sprint 3 (Command Palette):** Cmd+K palette (1.1) — needs API search endpoint, best done after other navigation improvements are in place
4. **Sprint 4 (Data Consistency):** Unified table component (3.1) + Skeleton loading (3.2) + Improved empty states (3.4)
5. **Sprint 5 (Polish):** Color system (4.1) + Typography (4.2) + Micro-interactions (4.3)
6. **Sprint 6 (Runs):** Agent run timeline (2.4) + Agent runs page filters (5.4)
7. **Sprint 7+ (Page-specific):** Board enhancements (5.1), Repos (5.2), Code Search (5.3)

---

## Design References

| App | What to Study | URL |
|-----|--------------|-----|
| Linear | Cmd+K, keyboard shortcuts, Kanban polish, issue detail | linear.app |
| Vercel | Dashboard layout, deployment timeline, Geist design system | vercel.com/geist |
| Cursor | AI chat + code artifact split pane, agent mode UI | cursor.com |
| Claude | Artifact panel, streaming output, tool call visualization | claude.ai |
| Trigger.dev | Run timeline, trace visualization, real-time updates | trigger.dev |
| Raycast | Action panels, instant search, keyboard-first design | raycast.com |
| GitHub Copilot Workspace | Issue-to-PR pipeline visualization | githubnext.com |
