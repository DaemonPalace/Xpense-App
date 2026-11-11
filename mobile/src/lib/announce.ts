import { AccessibilityInfo, Platform } from 'react-native';

/** iOS has no live regions, so speak the message through VoiceOver. Android uses accessibilityLiveRegion. */
export function announce(message: string) {
  if (Platform.OS === 'ios' && message) AccessibilityInfo.announceForAccessibility(message);
}
