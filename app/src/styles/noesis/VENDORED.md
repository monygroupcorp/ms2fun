# Vendored — do not hand-edit

These files are copied from the shared design system at `~/projects/design`
(the local, non-git source of truth). Brand changes happen **there**, then we
re-copy. See `~/projects/design/ADOPTION.md` and `identity/noesis/HANDOFF.md`.

| File | Source |
|---|---|
| `theme.css` | `~/projects/design/identity/noesis/theme.css` |
| `signature.css` | `~/projects/design/identity/noesis/signature.css` |
| `../../../public/fonts/{syne,archivo,ibm-plex-mono}/` | `~/projects/design/assets/fonts/<family>/` |
| `../../../public/fonts/fonts.css` | trimmed subset of `~/projects/design/assets/fonts/fonts.css` (NOESIS faces only) |

To update: re-run the `cp` commands in HANDOFF.md §2 after reading the design
CHANGELOG, then re-trim `public/fonts/fonts.css` to the three NOESIS faces.

Vendored against design system **v0.1.4**.
