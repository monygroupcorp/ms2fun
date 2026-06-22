import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'src/generated'] },

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
              group: ['@/components/*', '@/components/**', '@/routes/*', '@/routes/**'],
              message: 'lib/ must not import components or routes (one-way deps).',
            },
          ],
        },
      ],
    },
  },

  // components/ may not reach up into routes/.
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
              group: ['@/*', '@/**'],
              message: 'generated/ is a leaf; it must not import app code.',
            },
          ],
        },
      ],
    },
  },

  prettier,
)
