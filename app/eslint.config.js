import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  // Global ignores. `src/generated` is deliberately NOT listed: a config object carrying only
  // `ignores` is a GLOBAL ignore in flat config, so listing it here would exclude the tree from
  // every block below — including the `src/generated/**` leaf rule at the bottom of this file.
  // The generated tree lints clean under the shared rules as emitted, so it needs no exemption.
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Invariants: no `any`, no silent unused, and (G6) never import from legacy/.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/legacy/**', '*legacy*'], message: 'Never import from legacy/.' },
          ],
        },
      ],
    },
  },

  // One-way dependency direction: lib -> generated only (no components/routes).
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/legacy/**'], message: 'Never import from legacy/.' },
            {
              // `patterns.group` is minimatched against the RAW specifier string, so an alias-only
              // group cannot see the relative form the tree actually writes
              // (`../components/…`, `../../routes/…`). Both forms are listed.
              group: [
                '@/components/*',
                '@/components/**',
                '@/routes/*',
                '@/routes/**',
                '**/components/*',
                '**/components/**',
                '**/routes/*',
                '**/routes/**',
              ],
              message: 'lib/ must not import components or routes (one-way deps).',
            },
          ],
        },
      ],
    },
  },

  // components/ may not reach up into routes/.
  // NOTE: this group is still ALIAS-ONLY and therefore does not see the relative form. Widening it
  // the way the `src/lib/**` group above was widened surfaces live violations in this layer, whose
  // resolution is a separate change; tracked as follow-on work.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/legacy/**'], message: 'Never import from legacy/.' },
            {
              group: ['@/routes/*', '@/routes/**'],
              message: 'components/ must not import routes (one-way deps).',
            },
          ],
        },
      ],
    },
  },

  // generated/ is a leaf: it must not import app code.
  {
    files: ['src/generated/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Alias form plus the relative form: anything reaching out of `src/generated/`.
              group: ['@/*', '@/**', '../*', '../**'],
              message: 'generated/ is a leaf; it must not import app code.',
            },
          ],
        },
      ],
    },
  },

  prettier,
)
