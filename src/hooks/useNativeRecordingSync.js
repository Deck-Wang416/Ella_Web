import { useEffect } from "react";
import { nativeAudioSupported } from "../lib/nativeAudioApi.js";
import { SegmentedAudio } from "../lib/nativeSegmentedAudioApi.js";
import { cancelNativeRecordingSync, syncNativeRecordings } from "../lib/nativeRecordingSync.js";

export function useNativeRecordingSync(caregiverId) {
  useEffect(() => {
    if (!nativeAudioSupported || !caregiverId) return undefined;

    let listener;
    let disposed = false;
    function retry() {
      if (document.visibilityState === "visible") void syncNativeRecordings(caregiverId);
    }
    function onRecordingChange() { retry(); }

    void SegmentedAudio.addListener("recordingStateChanged", onRecordingChange).then((next) => {
      if (disposed) void next.remove();
      else listener = next;
    }).catch(() => {
      // The periodic and visibility retries still work if the listener is unavailable.
    });
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    const interval = window.setInterval(retry, 3000);
    retry();

    return () => {
      disposed = true;
      cancelNativeRecordingSync(caregiverId);
      void listener?.remove();
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
      window.clearInterval(interval);
    };
  }, [caregiverId]);
}
