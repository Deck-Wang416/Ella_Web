import { isNativeApp } from "./platform.js";

export async function registerServiceWorker() {
  if (isNativeApp) return null;
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    return registration;
  } catch (error) {
    console.error('Service worker registration failed:', error);
    return null;
  }
}
