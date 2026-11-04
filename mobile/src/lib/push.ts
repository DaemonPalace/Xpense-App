import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let registered = false;

/**
 * Registers this device for spending alerts (FR-10.2). Silently does nothing where remote push can't work:
 * simulators, Expo Go on Android, or builds without an EAS project id (`eas init`). The home banner still shows alerts.
 */
export async function registerForPush(): Promise<void> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (registered || !Device.isDevice || !projectId) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alerts', { name: 'Alertas de gasto', importance: AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('POST', '/api/devices', { token, platform: Platform.OS });
    registered = true;
  } catch {
    // offline or push unavailable: try again next launch
  }
}
