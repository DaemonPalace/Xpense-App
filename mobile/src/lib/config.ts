// Filled from `mobile/.env` (see .env.example). EXPO_PUBLIC_* values are inlined at build time: never put secrets here.
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
};
