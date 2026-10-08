# Design System — CodeCollab (Royal & Technical)

<!-- impeccable:design-schema 1 -->

## Design Direction & Philosophy

CodeCollab is a royal, high-end, distraction-free collaborative IDE and execution platform. The visual world is tailored for elite engineers, systems builders, and computer scientists who demand calm confidence, precision, and technical elegance. 

It rejects generic AI-generated SaaS templates, decorative gradient text, unmotivated glassmorphism, floating glow blobs, and noisy card grids. Instead, the UI is anchored in architectural restraint, intentional contrast, and structured ergonomics:

1. **Restrained Royal Atmosphere**: Deep Black (`#0A0A0A`) and Charcoal (`#18181B`) surfaces in dark mode, balanced by Warm White (`#F5F3EE`) and Beige (`#E8E1D5`) accents, with deliberate Light Blue (`#A8D8FF`) / Royal Blue (`#7DB9E8`) strategic highlights.
2. **Confidence Through Hierarchy**: Clear typography steps (Plus Jakarta Sans for headings, Inter for interface metadata, JetBrains Mono for code and execution metrics) communicate importance without relying on loud colors.
3. **Ergonomic Surfaces**: Monaco-grade panels, clean tab bars with active line accents, crisp dark borders (`#27272A`), high-contrast monospace terminals, and unpolluted collaboration indicators.
4. **Calculated Motion & Micro-Interactions**: Snappy, exponential-out ease transitions (100–150ms) for buttons, inputs, tabs, and connection state changes. Zero unnecessary floating or spinning animations.

---

## Color Tokens

The visual system uses a calibrated royal palette designed for prolonged focus:

| Token Name | Hex Code | Role & Usage |
|:---|:---|:---|
| **Deep Black** | `#0A0A0A` | Primary app canvas & background (Dark Mode) |
| **Soft Black** | `#111111` | Secondary surfaces, sidebars, terminal backing |
| **Charcoal** | `#18181B` | Elevated cards, dialog backdrops, floating menus |
| **Dark Gray** | `#27272A` | Crisp structural borders, dividers, subtle active states |
| **Gray** | `#52525B` | Tertiary metadata, icons, muted borders |
| **Light Gray** | `#A1A1AA` | Secondary labels, descriptions, helper text (contrast ≥ 5.5:1) |
| **Beige** | `#E8E1D5` | Premium highlights, subtle milestone tags, luxury separators |
| **Warm White** | `#F5F3EE` | Primary high-contrast text in dark mode, canvas in light mode |
| **Pure White** | `#FFFFFF` | Maximum focus elements, active badges, crisp icons |
| **Light Blue** | `#A8D8FF` | Primary action accent, focus rings, active tab lines, live pulses |
| **Royal Blue** | `#7DB9E8` | Secondary action tint, hover states for links, active selections |

### Strict Color Hierarchy Rules
- **Primary background**: Deep Black (`#0A0A0A`) / Soft Black (`#111111`).
- **Secondary surfaces**: Charcoal (`#18181B`) / Dark Gray (`#27272A`).
- **Cards & elevated surfaces**: Soft Black (`#111111`) or Charcoal (`#18181B`) with Dark Gray (`#27272A`) 1px border.
- **Primary text**: Warm White (`#F5F3EE`) or Pure White (`#FFFFFF`).
- **Secondary text**: Light Gray (`#A1A1AA`) / Gray (`#52525B`).
- **Accent (Light Blue `#A8D8FF` & Royal Blue `#7DB9E8`)**: Reserved strictly for primary action buttons, active tab underlines, focus rings, peer presence pings, and important status indicators.
- **Warm Accent (Beige `#E8E1D5`)**: Used sparingly for premium pill badges, milestone indicators, and subtle technical separators.

---

## Typography & Font Weights

- **Display 1 (Landing Hero Title)**: `text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white` (Solid foreground, never gradient text).
- **Heading 1**: `text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F3EE]`.
- **Heading 2**: `text-xl sm:text-2xl font-bold tracking-tight text-[#F5F3EE]`.
- **Heading 3 (Section / Card Titles)**: `text-sm sm:text-base font-semibold tracking-tight text-[#F5F3EE]`.
- **Body Regular**: `text-xs sm:text-sm leading-relaxed text-[#A1A1AA]`.
- **Body Small / Captions**: `text-[11px] sm:text-xs leading-normal text-[#71717A]`.
- **Code & Diagnostics**: `font-mono text-xs sm:text-[13px] leading-relaxed text-[#E8E1D5]` or `#F5F3EE`.
- **Navigation & Badges**: `text-xs font-medium tracking-normal`.

---

## Spacing & Border Radius Scale

### Spacing Scale
- `space-1` (`4px`): Micro gaps between icons and adjacent text.
- `space-2` (`8px`): Compact component padding, pill badge spacing.
- `space-3` (`12px`): Input internal padding, card gap, tab padding.
- `space-4` (`16px`): Standard container padding, header heights (`h-14`), modal headers.
- `space-6` (`24px`): Card padding, section gaps.
- `space-8` (`32px`): Major component separation.
- `space-12` to `space-20`: Section vertical rhythm.

### Border Radius
- **Radius xs** (`4px`): Mini tags, status dots, inline code snippets.
- **Radius sm** (`6px`): Small buttons (`h-8`), tooltips, dropdown items.
- **Radius md** (`8px`): Standard buttons (`h-9`), inputs, file list rows, tab pills.
- **Radius lg** (`10px`): Elevating card containers, dialog boxes, preview panels.
- **Radius xl** (`12px`): Outer auth modal containers, hero interface frames.

---

## Component Standards

### 1. Buttons
- **Primary**: Background `#A8D8FF`, text `#0A0A0A`, font-semibold. Hover `#7DB9E8`, active scale `0.98`. Focus ring `#A8D8FF/40`.
- **Secondary**: Background `#18181B`, border `1px solid #27272A`, text `#F5F3EE`. Hover `#27272A`, text white.
- **Outline**: Background transparent, border `1px solid #27272A`, text `#A1A1AA`. Hover background `#18181B`, text `#F5F3EE`.
- **Ghost**: Background transparent, text `#A1A1AA`. Hover background `#18181B`, text `#F5F3EE`.
- **Destructive**: Background `#EF4444/15`, border `1px solid #EF4444/30`, text `#F87171`. Hover background `#EF4444/25`.
- **Icon-Only**: `size-8` or `size-9`, centered icon, crisp hover surface.

### 2. Form Inputs & Selects
- Height: `h-9` (compact) or `h-10` (standard).
- Background: `#111111` (dark) / `#FFFFFF` (light).
- Border: `1px solid #27272A` (dark) / `#DCD6CA` (light).
- Focus: Border `#A8D8FF`, double-ring `ring-2 ring-[#A8D8FF]/20`.
- Placeholder: `#52525B` with high contrast ≥ 4.5:1.

### 3. Cards & Panels
- Background: `#111111` or `#141417`.
- Border: `1px solid #27272A`.
- Shadow: Subtle `0 1px 2px rgba(0,0,0,0.4)` (no loud fuzzy glow or neobrutalist offset).
- Header: Clear typography, subtle separator line where appropriate.

### 4. Navigation & Topbars
- Height: `h-14` (`56px`).
- Background: `#0A0A0A/90` with subtle border-b `#27272A`.
- Breadcrumb navigation: Clean chevron separators, room ID badge with 1-click copy feedback.

### 5. Workspace Editor, Tabs & Terminal
- **Active Tab**: Background `#0E0E10`, border-b-2 `#A8D8FF`, text `#F5F3EE`, language indicator dot.
- **Inactive Tab**: Background `#141417`, text `#71717A`, hover text `#A1A1AA`.
- **Terminal Panel**: Monospace `#E8E1D5` / `#F5F3EE`, status bar with clean exit codes, copy logs, stdin drawer.
- **File Explorer**: Tree structure, language-coded glyphs, active row highlight `#18181B`.

### 6. Modals & Dialogs
- Backdrop: `rgba(0, 0, 0, 0.75)` with subtle blur.
- Container: Background `#111111`, border `1px solid #27272A`, radius `12px`, padding `24px`.
- Actions: Clean secondary cancel + primary confirm button.

### 7. Empty, Loading & Error States
- **Loading**: Monospace skeleton pulse or subtle `#A8D8FF` spinner.
- **Empty States**: Clear three-step explanation: what is empty, why it matters, and a primary CTA to resolve it.
- **Error States**: Humane, actionable recovery guidance (e.g., "Unable to connect to synchronization cluster. Retrying in 3s...") with technical diagnostics available on demand.

---

## Craft Floor Refusals Enforced
1. **No gradient text** anywhere in the application.
2. **No floating kickers/eyebrows** above headings.
3. **No gratuitous glassmorphic glow blobs or neobrutalist block shadows**.
4. **No colored left/right indicator stripes** thicker than 2px.
5. **No emoji substituting for UI icons** — only Lucide SVG icons.
