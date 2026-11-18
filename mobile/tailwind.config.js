/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Neutral graphite surfaces; teal (brand) is the only accent.
        canvas: '#F6F7F7', panel: '#FFFFFF', ink: '#171A1A', muted: '#5A6261', line: '#E4E7E7', raised: '#EEF0F0',
        // field: input borders (≥ 3:1 on white and canvas); hint: placeholder text (≥ 4.5:1 on white).
        field: '#7A8483', hint: '#646C6B',
        brand: '#0F766E', 'brand-soft': '#DDF3EF', 'brand-dark': '#0B4F4A',
        mint: '#D1FAE5', green: '#047857', amber: '#B45309', 'amber-soft': '#FEF3C7', danger: '#B91C1C',
      },
      // Plus Jakarta Sans: one family name per weight (fontWeight is not used with Google Font packages).
      // Weights stop at 600: `strong` is semibold and `heavy` (titles, big figures) is medium; hierarchy comes from size.
      fontFamily: {
        body: ['PlusJakartaSans_400Regular'],
        label: ['PlusJakartaSans_500Medium'],
        semi: ['PlusJakartaSans_600SemiBold'],
        strong: ['PlusJakartaSans_600SemiBold'],
        heavy: ['PlusJakartaSans_500Medium'],
      },
    },
  },
  plugins: [],
};
