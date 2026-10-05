# Inkway visual identity

Inkway moves work from an issue to an AI coding agent and a reviewable result. The reference direction is precise, calm, technical, focused, reliable, and minimal. Intentional space and clear hierarchy organize the interface.

## Palette

| Name | Hex | Role |
| --- | --- | --- |
| Indigo | `#1E3A8A` | Primary actions, focus, and links |
| Washi | `#FAF8F4` | Light-mode canvas |
| Stone | `#EAE7E1` | Quiet secondary surfaces |
| Sumi | `#1F2937` | Main text; dark-mode canvas |
| Slate | `#64748B` | Supporting palette; darker derivatives for small text |
| Moss | `#2F6F46` | Verified success and Active Inks |
| Sand | `#D4A373` | Evaluation palette; darker derivatives for readable warnings |
| Beni | `#B23838` | Failure and critical states |

The default is light. Existing theme preferences still apply. Dark mode uses Sumi surfaces, warm paper text, and a lighter indigo for readable actions. Shared text tokens meet 4.5:1 contrast across all standard surfaces; non-text detail tokens meet 3:1. Sand itself is decorative: small warning text uses its darker derivative.

## Mark and type

The mark is a straight path through two checkpoints to a forward arrow. It works at favicon size and in monochrome. Use Sumi and Indigo on Washi in browser/PWA and desktop icons. The app wordmark and welcome heading use Source Serif 4, with Inter for controls and body text. Monospace remains for code and diagnostics.

## Space and motion

Use the 8px spacing rhythm (4, 8, 16, 24, 32, 48, 64) and existing compact control heights. Cards have quiet borders, restrained corners, and subtle shadows. Onboarding uses three numbered setup cards. Keep decorative textures confined to editorial material; task screens prioritize readability. Avoid hover spins and bouncing marks; use brief opacity or position transitions.

## Source and assets

`packages/ui/styles/tokens.css` is shared by web and desktop. Inline mark geometry lives in `packages/ui/components/common/inkway-icon.tsx`. Browser icon SVGs live under `apps/web/public/`. Run `node scripts/generate-inkway-icons.mjs` at the repository root to regenerate browser/PWA PNGs and desktop PNG, ICO, and ICNS assets. ICNS export requires macOS.

Visual checks are saved under `artifacts/inkway-brand/`. These are real app screenshots; issue and provider data are not inferred from the reference board.
