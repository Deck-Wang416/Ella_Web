package com.ella.parentportal;

import android.Manifest;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "SegmentedAudio", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
})
public class SegmentedAudioPlugin extends Plugin {
    private static WeakReference<SegmentedAudioPlugin> activePlugin = new WeakReference<>(null);

    @Override public void load() {
        activePlugin = new WeakReference<>(this);
    }

    static void notifyUploadCompleted(JSONObject manifest) {
        SegmentedAudioPlugin plugin = activePlugin.get();
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            result.put("status", "uploaded");
            JSObject recording = SegmentStore.summary(manifest);
            result.put("latestRecording", recording);
            plugin.notifyListeners("recordingStateChanged", result);
        });
    }

    private int caregiver(PluginCall call) {
        Integer value = call.getInt("caregiverId");
        return value == null ? 0 : value;
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (caregiver(call) <= 0 || call.getString("date") == null ||
            !call.getString("date").matches("\\d{4}-\\d{2}-\\d{2}")) {
            call.reject("A caregiver and recording date are required.");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "recordPermissionGranted");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void recordPermissionGranted(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone access is required.");
            return;
        }
        startService(call);
    }

    private void startService(PluginCall call) {
        if (SegmentedAudioService.hasActiveRecording()) {
            call.reject("A recording is already in progress.");
            return;
        }
        String id = UUID.randomUUID().toString().toLowerCase();
        Intent intent = new Intent(getContext(), SegmentedAudioService.class);
        intent.setAction(SegmentedAudioService.ACTION_START);
        intent.putExtra(SegmentedAudioService.EXTRA_ID, id);
        intent.putExtra(SegmentedAudioService.EXTRA_CAREGIVER, caregiver(call));
        intent.putExtra(SegmentedAudioService.EXTRA_DATE, call.getString("date"));
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            new Thread(() -> {
                try {
                    for (int attempt = 0; attempt < 100; attempt++) {
                        if (SegmentedAudioService.startFailed(id)) break;
                        if (SegmentedAudioService.isReady(id)) {
                            JSObject result = new JSObject();
                            result.put("status", "recording");
                            call.resolve(result);
                            notifyListeners("recordingStateChanged", result);
                            return;
                        }
                        Thread.sleep(100);
                    }
                    // A slow service may still start after the wait expires; stop only this attempt.
                    Intent stop = new Intent(getContext(), SegmentedAudioService.class);
                    stop.setAction(SegmentedAudioService.ACTION_STOP);
                    stop.putExtra(SegmentedAudioService.EXTRA_ID, id);
                    stop.putExtra(SegmentedAudioService.EXTRA_CAREGIVER, caregiver(call));
                    try { getContext().startService(stop); } catch (Exception ignored) {}
                    call.reject("Unable to start recording. Please try again.");
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    call.reject("Unable to start recording. Please try again.");
                }
            }, "EllaRecordingStart").start();
        } catch (Exception error) {
            call.reject("Unable to start recording.", null, error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        int caregiverId = caregiver(call);
        String id = SegmentedAudioService.activeRecordingId(caregiverId);
        if (id == null) { call.reject("No recording is in progress."); return; }
        Intent intent = new Intent(getContext(), SegmentedAudioService.class);
        intent.setAction(SegmentedAudioService.ACTION_STOP);
        intent.putExtra(SegmentedAudioService.EXTRA_ID, id);
        intent.putExtra(SegmentedAudioService.EXTRA_CAREGIVER, caregiverId);
        getContext().startService(intent);
        new Thread(() -> {
            try {
                for (int attempt = 0; attempt < 100 && SegmentedAudioService.isCapturing(caregiverId, id); attempt++) {
                    Thread.sleep(100);
                }
                if (SegmentedAudioService.isCapturing(caregiverId, id)) throw new IOException("Recording did not stop");
                synchronized (SegmentStore.LOCK) {
                    JSONObject manifest = SegmentStore.read(SegmentStore.folder(getContext(), caregiverId, id));
                    if (!manifest.optBoolean("stopped") || manifest.optInt("segmentCount") == 0)
                        throw new IOException("No audio was captured");
                    JSObject result = new JSObject();
                    result.put("status", "saved");
                    result.put("recording", SegmentStore.summary(manifest));
                    call.resolve(result);
                    notifyListeners("recordingStateChanged", result);
                }
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }, "EllaRecordingStop").start();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        int caregiverId = caregiver(call);
        if (caregiverId <= 0) { call.reject("A caregiver account is required."); return; }
        JSObject result = new JSObject();
        String active = SegmentedAudioService.activeRecordingId(caregiverId);
        if (active != null) {
            result.put("status", "recording");
            result.put("elapsedSeconds", SegmentedAudioService.elapsedSeconds(caregiverId));
        } else {
            boolean interrupted = SegmentedAudioService.wasInterrupted(caregiverId);
            result.put("status", interrupted ? "interrupted" : "idle");
            result.put("elapsedSeconds", 0);
            if (interrupted) result.put("error", SegmentedAudioService.interruptionError(caregiverId));
            try {
                List<File> folders = SegmentStore.directories(getContext(), caregiverId);
                for (int index = folders.size() - 1; index >= 0; index--) {
                    try {
                        JSONObject manifest = SegmentStore.read(folders.get(index));
                        if (manifest.optInt("segmentCount") <= 0 || manifest.optBoolean("uploaded")) continue;
                        if (interrupted && !manifest.optString("id").equals(
                            SegmentedAudioService.interruptedRecordingId(caregiverId))) continue;
                        result.put("status", interrupted ? "interrupted" : "saved");
                        result.put("elapsedSeconds", manifest.optDouble("durationSeconds"));
                        result.put("latestRecording", SegmentStore.summary(manifest));
                        break;
                    } catch (Exception ignored) { /* Keep looking for a readable recording. */ }
                }
            } catch (IOException ignored) { /* An empty directory is an idle recorder. */ }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void getPendingUploads(PluginCall call) {
        int caregiverId = caregiver(call);
        if (caregiverId <= 0) { call.reject("A caregiver account is required."); return; }
        synchronized (SegmentStore.LOCK) {
            try {
                JSArray pending = new JSArray();
                int unreadable = 0;
                int cleanupFailures = 0;
                for (File directory : SegmentStore.directories(getContext(), caregiverId)) {
                    try {
                        JSONObject manifest = SegmentStore.read(directory);
                        if (manifest.optBoolean("uploaded") || manifest.optBoolean("uploadCompleted")) {
                            try {
                                SegmentStore.deleteTree(directory);
                                SegmentedAudioService.clearInterruption(caregiverId, manifest.optString("id"));
                            }
                            catch (IOException error) { cleanupFailures++; }
                            continue;
                        }
                        if (!manifest.optBoolean("stopped") &&
                            !SegmentedAudioService.isCapturing(caregiverId, manifest.optString("id"))) {
                            File partial = SegmentStore.segment(directory, manifest.optInt("segmentCount"));
                            if (partial.exists() && !partial.delete()) throw new IOException("Cannot discard partial segment");
                            manifest.put("stopped", true);
                            SegmentStore.write(directory, manifest);
                        }
                        if (manifest.optBoolean("stopped") && manifest.optInt("segmentCount") == 0) {
                            SegmentStore.deleteTree(directory);
                            continue;
                        }
                        if (manifest.optInt("nextChunkIndex") > manifest.optInt("segmentCount")) {
                            unreadable++;
                            continue;
                        }
                        pending.put(SegmentStore.summary(manifest));
                    } catch (Exception error) { unreadable++; }
                }
                JSObject response = new JSObject();
                response.put("recordings", pending);
                response.put("unreadableCount", unreadable);
                response.put("cleanupFailureCount", cleanupFailures);
                JSONObject recent = AndroidRecordingUploader.get(getContext()).recentUpload(caregiverId);
                if (recent != null) response.put("recentUpload", recent);
                call.resolve(response);
            } catch (Exception error) { call.reject("Unable to read saved recordings.", null, error); }
        }
    }

    private File targetDirectory(PluginCall call) throws Exception {
        int caregiverId = caregiver(call);
        String id = call.getString("id");
        if (caregiverId <= 0 || id == null) throw new IOException("A caregiver and recording are required");
        File directory = SegmentStore.folder(getContext(), caregiverId, id);
        JSONObject manifest = SegmentStore.read(directory);
        if (manifest.optInt("caregiverId") != caregiverId || !manifest.optString("id").equals(id.toLowerCase()))
            throw new IOException("Recording account mismatch");
        return directory;
    }

    @PluginMethod
    public void configureUploader(PluginCall call) {
        try {
            int caregiverId = caregiver(call);
            if (caregiverId <= 0 || call.getString("apiBase") == null)
                throw new IOException("A caregiver and recording API URL are required");
            AndroidRecordingUploader.get(getContext()).configure(call.getString("apiBase"));
            SegmentedAudioService.ensureUploadService(getContext());
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), null, error); }
    }

    @PluginMethod
    public void syncUploads(PluginCall call) {
        if (caregiver(call) <= 0) { call.reject("A caregiver account is required"); return; }
        try {
            SegmentedAudioService.ensureUploadService(getContext());
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), null, error); }
    }

    @PluginMethod
    public void pauseUpload(PluginCall call) {
        try {
            File directory = targetDirectory(call);
            AndroidRecordingUploader.get(getContext()).pause(caregiver(call), directory.getName());
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), null, error); }
    }

    @PluginMethod
    public void resumeUpload(PluginCall call) {
        if (caregiver(call) <= 0 || call.getString("id") == null) {
            call.reject("A caregiver and recording are required"); return;
        }
        AndroidRecordingUploader.get(getContext()).resume(caregiver(call), call.getString("id").toLowerCase());
        call.resolve();
    }

    @PluginMethod
    public void discardRecording(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                String sessionId = manifest.isNull("sessionId") ? null : manifest.optString("sessionId", null);
                if (!manifest.optBoolean("stopped") ||
                    SegmentedAudioService.isCapturing(caregiver(call), manifest.optString("id")) ||
                    !java.util.Objects.equals(sessionId, call.getString("sessionId")))
                    throw new IOException("Recording cannot be discarded while active or after its session changes");
                manifest.put("uploaded", true);
                SegmentStore.write(directory, manifest);
                SegmentStore.deleteTree(directory);
                SegmentedAudioService.clearInterruption(caregiver(call), manifest.optString("id"));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
    }

}
