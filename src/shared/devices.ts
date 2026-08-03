// Device presets (PLAN §4.6). Metrics + DPR + touch + UA, shared by host and webview.
export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  touch: boolean;
  userAgent?: string;
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, dpr: 2, touch: true, userAgent: IOS_UA },
  { id: 'iphone-15', label: 'iPhone 15', width: 393, height: 852, dpr: 3, touch: true, userAgent: IOS_UA },
  { id: 'iphone-15-pro-max', label: 'iPhone 15 Pro Max', width: 430, height: 932, dpr: 3, touch: true, userAgent: IOS_UA },
  { id: 'pixel-8', label: 'Pixel 8', width: 412, height: 915, dpr: 2.625, touch: true, userAgent: ANDROID_UA },
  { id: 'galaxy-s24', label: 'Galaxy S24', width: 360, height: 780, dpr: 3, touch: true, userAgent: ANDROID_UA },
  { id: 'ipad', label: 'iPad', width: 820, height: 1180, dpr: 2, touch: true, userAgent: IPAD_UA },
  { id: 'desktop-1080', label: 'Desktop 1080p', width: 1920, height: 1080, dpr: 1, touch: false },
  { id: 'desktop-1440', label: 'Desktop 1440p', width: 2560, height: 1440, dpr: 1, touch: false },
];

export function findPreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((d) => d.id === id);
}

/** Rotate swaps width/height; everything else about the device is unchanged. */
export function rotate(p: DevicePreset): DevicePreset {
  return { ...p, width: p.height, height: p.width };
}
