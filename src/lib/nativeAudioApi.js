import { Capacitor } from "@capacitor/core";

export const nativeAudioSupported = Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android";
