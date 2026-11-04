// amazon-cognito-identity-js reads global.crypto when it loads, so this module must be imported before it.
import { getRandomValues } from 'expo-crypto';

const g = globalThis as any;
if (typeof g.crypto?.getRandomValues !== 'function') g.crypto = { ...(g.crypto ?? {}), getRandomValues };
