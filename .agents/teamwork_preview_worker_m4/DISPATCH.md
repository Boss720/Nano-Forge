## 2026-08-15T12:44:36Z
You are Worker M4 for NanoForge (M4: Dynamic UI Palette & Theme Customizer).
Your working directory is: c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_worker_m4/

You MUST read:
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/ORIGINAL_REQUEST.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/PROJECT.md
- c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge/.agents/teamwork_preview_explorer_survey_2/analysis.md
- Existing frontend theme files (`src/index.css`, `tailwind.config.js`, `src/sections/ConnectDialog.tsx`, `src/main.tsx`)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope & Exclusively Owned Files:
- `src/lib/themePalette.ts`: Define 7 calibrated presets (Ember Forge, Cyberpunk Neon, Emerald Matrix, Amethyst Velvet, Solar Flare, Midnight Slate, Monochrome Obsidian), CSS custom property applicator that writes directly to `document.documentElement.style` without page reload, `localStorage` persistence, custom color palette builders (primary hue, saturation, lightness, surface contrast, accent hue, border radius), and hydration on app boot.
- `src/sections/settings/ThemeCustomizer.tsx`: Beautiful, polished theme customizer component with preset cards, real-time hue sliders, surface contrast selectors, border radius controls, live preview swatch, and "Reset to Default" button.
- `src/sections/ConnectDialog.tsx` (and/or `TopBar.tsx` / `App.tsx`): Integrate the Theme Customizer into the UI settings / appearance modal so users can access and customize themes anytime.
- `src/lib/__tests__/themePalette.test.ts` & `src/sections/__tests__/ThemeCustomizer.test.tsx`: Comprehensive unit and DOM tests verifying preset loading, CSS variable application, slider changes, and localStorage persistence.

Verification commands:
- Run `npm test`
- Run `npm run build`
Ensure 100% tests pass and 0 build errors.

Output Requirements:
- Write `changes.md` and `handoff.md` to your working directory.
- Send a completion message to the orchestrator.
