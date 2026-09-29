import { Capacitor, registerPlugin } from "@capacitor/core";

export const nativeAudioSupported = Capacitor.getPlatform() === "ios";

export const NativeAudio = registerPlugin("NativeAudio");
