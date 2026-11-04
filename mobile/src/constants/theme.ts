
// Capstone palette: white smoke background, green-yellow secondary, light green accents.
// greenYellow / lightGreen are fills only (fail contrast as text); use `accentText` for text.
export const Colors = {
  background: '#F5F5F5',
  surface: '#FFFFFF',
  border: '#C0C0C0',
  text: '#1B1F1A',
  textSecondary: '#5A6157',
  greenYellow: '#ADFF2F',
  lightGreen: '#90EE90',
  accentText: '#2E6B1F',
  danger: '#B3261E',
} as const;

export const Spacing = { one: 4, two: 8, three: 16, four: 24, five: 32 } as const;
