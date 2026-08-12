# Vendored — do not hand-edit

These files are copied in from the shared NOESIS design system, which lives outside
this repo and is its own source of truth. Brand changes happen **there**, then we
re-copy; edits made here are overwritten on the next re-vendor.

| File                                                  | Source (design system root)                              |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `theme.css`                                           | `identity/noesis/theme.css`                              |
| `signature.css`                                       | `identity/noesis/signature.css`                          |
| `../../../public/fonts/{syne,archivo,ibm-plex-mono}/` | `assets/fonts/<family>/`                                 |
| `../../../public/fonts/fonts.css`                     | trimmed subset of `assets/fonts/fonts.css` (NOESIS faces only) |

To update: re-copy each file above from the design system after reading its
CHANGELOG, then re-trim `public/fonts/fonts.css` to the three NOESIS faces.

Vendored against design system **v0.1.4**.
