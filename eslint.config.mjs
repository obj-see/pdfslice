// @ts-check
import antfu from '@antfu/eslint-config'
import vitestPlugin from '@vitest/eslint-plugin'

export default antfu(
  {
    typescript: {
      tsconfigPath: 'tsconfig.json',
    },
    formatters: true,
    ignores: ['**/bin'],
  },
  {
    rules: {
      ...vitestPlugin.configs.recommended.rules,

      'ts/consistent-type-definitions': ['error', 'type'],
      'no-param-reassign': 'off',
      'style/spaced-comment': [
        'warn',
        'always',
        {
          markers: ['/'],
        },
      ],
    },
  },
)
