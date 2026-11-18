import { describe, expect, it } from 'vitest';
import { formatCOP, groupPesos, localDate, parsePesos } from '../src/lib/money';
import { missingRules } from '../src/lib/password';

describe('money input', () => {
  it('parses pesos typed with or without grouping into minor units', () => {
    expect(parsePesos('15.000')).toBe(1_500_000);
    expect(parsePesos('15000')).toBe(1_500_000);
    expect(parsePesos('$ 1.500.000')).toBe(150_000_000);
    for (const empty of ['', '0', '000', 'abc']) expect(parsePesos(empty)).toBeNull();
  });

  it('groups digits for display and round-trips through parsePesos', () => {
    expect(groupPesos('1500000')).toBe('1.500.000');
    expect(groupPesos('999')).toBe('999');
    expect(parsePesos(groupPesos('1234567'))).toBe(123_456_700);
  });

  it('formats minor units as whole pesos', () => {
    expect(formatCOP(1_500_099).replace(/\s/g, ' ')).toMatch(/^\$ ?15\.000$/);
  });

  it('dates in the device day, not UTC', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('password rules (mirror the Cognito policy)', () => {
  it('lists what a password still lacks', () => {
    expect(missingRules('Abcdef1!')).toEqual([]);
    expect(missingRules('abc')).toEqual(['8 caracteres o más', 'una mayúscula', 'un número', 'un símbolo (por ejemplo ! @ # $ %)']);
    expect(missingRules('ABCDEFG1-')).toEqual(['una minúscula']);
  });

  it('does not count accented letters or unlisted symbols (Cognito does not)', () => {
    expect(missingRules('ÁÉÍÓÚáé1!')).toContain('una mayúscula');
    expect(missingRules('Abcdefg1¡')).toContain('un símbolo (por ejemplo ! @ # $ %)');
  });
});
