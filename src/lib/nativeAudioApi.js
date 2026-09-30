import { Capacitor, registerPlugin } from "@capacitor/core";

export const nativeAudioSupported = Capacitor.getPlatform() === "ios" || Capacitor.getPlatform() === "android";

export const NativeAudio = registerPlugin("NativeAudio");
