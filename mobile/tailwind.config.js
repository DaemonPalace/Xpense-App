/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        canvas: '#F3F8F7', panel: '#FFFFFF', ink: '#0F2E2B', muted: '#4A6361', line: '#D9E6E3',
        brand: '#0F766E', 'brand-soft': '#DDF3EF', 'brand-dark': '#0B4F4A',
        mint: '#D1FAE5', green: '#047857', amber: '#B45309', 'amber-soft': '#FEF3C7', danger: '#B91C1C',
      },
      // Plus Jakarta Sans: one family name per weight (fontWeight is not used with Google Font packages).
      fontFamily: {
        body: ['PlusJakartaSans_400Regular'],
        label: ['PlusJakartaSans_500Medium'],
        semi: ['PlusJakartaSans_600SemiBold'],
        strong: ['PlusJakartaSans_700Bold'],
        heavy: ['PlusJakartaSans_800ExtraBold'],
      },
    },
  },
  plugins: [],
};
