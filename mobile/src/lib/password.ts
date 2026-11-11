// Cognito counts only A–Z/a–z as letters and this exact symbol set. Mirrors the Cognito password policy in infra/stack.ts (min 8, upper, lower, digit, symbol). Keep both in sync.
export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: '8 caracteres o más', ok: p => p.length >= 8 },
  { label: 'una mayúscula', ok: p => /[A-Z]/.test(p) },
  { label: 'una minúscula', ok: p => /[a-z]/.test(p) },
  { label: 'un número', ok: p => /\d/.test(p) },
  { label: 'un símbolo (por ejemplo ! @ # $ %)', ok: p => /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+-]/.test(p) },
];

/** Labels of the rules the password still breaks (empty when valid). */
export const missingRules = (p: string) => PASSWORD_RULES.filter(r => !r.ok(p)).map(r => r.label);
