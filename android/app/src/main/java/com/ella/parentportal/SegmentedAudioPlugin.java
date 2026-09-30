package com.ella.parentportal;

import android.Manifest;
import android.content.Intent;
import android.util.Base64;

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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "SegmentedAudio", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
})
public class SegmentedAudioPlugin extends Plugin {
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
                        if (manifest.optBoolean("uploaded")) {
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
    public void setUploadSession(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                String sessionId = call.getString("sessionId");
                if (sessionId == null || sessionId.isEmpty() ||
                    (!manifest.isNull("sessionId") && !sessionId.equals(manifest.optString("sessionId"))))
                    throw new IOException("Recording session mismatch");
                manifest.put("sessionId", sessionId);
                SegmentStore.write(directory, manifest);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
    }

    @PluginMethod
    public void readUploadChunk(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                int index = manifest.optInt("nextChunkIndex");
                if (manifest.isNull("sessionId") || index >= manifest.optInt("segmentCount"))
                    throw new IOException("No sealed audio segment is ready");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                try (FileInputStream stream = new FileInputStream(SegmentStore.segment(directory, index))) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
                }
                byte[] data = bytes.toByteArray();
                if (data.length == 0) throw new IOException("Audio segment is empty");
                JSObject result = new JSObject();
                result.put("base64", Base64.encodeToString(data, Base64.NO_WRAP));
                result.put("byteCount", data.length);
                result.put("chunkIndex", index);
                result.put("mimeType", "audio/wav");
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
    }

    @PluginMethod
    public void confirmUploadChunk(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                Integer index = call.getInt("chunkIndex");
                if (index == null || index != manifest.optInt("nextChunkIndex") ||
                    index >= manifest.optInt("segmentCount") ||
                    !manifest.optString("sessionId").equals(call.getString("sessionId")))
                    throw new IOException("Upload progress mismatch");
                manifest.put("nextChunkIndex", index + 1);
                SegmentStore.write(directory, manifest);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
    }

    @PluginMethod
    public void resetUploadSession(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                manifest.put("sessionId", JSONObject.NULL);
                manifest.put("nextChunkIndex", 0);
                SegmentStore.write(directory, manifest);
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
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

    @PluginMethod
    public void deleteUploadedRecording(PluginCall call) {
        synchronized (SegmentStore.LOCK) {
            try {
                File directory = targetDirectory(call);
                JSONObject manifest = SegmentStore.read(directory);
                // The server's verified final audio is authoritative even if a local ack was
                // lost after the final segment reached Storage.
                if (!manifest.optBoolean("stopped") ||
                    !manifest.optString("sessionId").equals(call.getString("sessionId")))
                    throw new IOException("Audio is not finalized");
                manifest.put("uploaded", true);
                SegmentStore.write(directory, manifest);
                SegmentStore.deleteTree(directory);
                SegmentedAudioService.clearInterruption(caregiver(call), manifest.optString("id"));
                call.resolve();
            } catch (Exception error) { call.reject(error.getMessage(), null, error); }
        }
    }
}
