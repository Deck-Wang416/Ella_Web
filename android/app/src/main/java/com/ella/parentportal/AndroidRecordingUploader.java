package com.ella.parentportal;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

// Uploads sealed WAV files outside the WebView; the manifest is the durable checkpoint.
final class AndroidRecordingUploader {
    private static final String DEFAULT_API = "https://hri-autism-backend.onrender.com/api";
    private static final String PREFS = "ella_recording_upload";
    private static AndroidRecordingUploader instance;

    static synchronized AndroidRecordingUploader get(Context context) {
        if (instance == null) instance = new AndroidRecordingUploader(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final SharedPreferences preferences;
    private final ExecutorService control = Executors.newSingleThreadExecutor();
    private final ExecutorService chunks = Executors.newFixedThreadPool(4);
    private final ScheduledExecutorService retries = Executors.newSingleThreadScheduledExecutor();
    private final Set<String> running = new HashSet<>();
    private final Set<String> rerun = new HashSet<>();
    private final Set<String> paused = new HashSet<>();
    private final Map<String, Long> retryAt = new HashMap<>();
    private final Map<String, Integer> retryCount = new HashMap<>();

    private AndroidRecordingUploader(Context context) {
        this.context = context;
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void configure(String base) throws IOException {
        URL url = new URL(base);
        if (!"https".equals(url.getProtocol()) || url.getHost().isEmpty() ||
            !url.getPath().endsWith("/api") || url.getUserInfo() != null || url.getQuery() != null ||
            url.getRef() != null) throw new IOException("A valid recording API URL is required");
        preferences.edit().putString("apiBase", base.replaceAll("/+$", "")).apply();
    }

    JSONObject recentUpload(int caregiverId) {
        String key = "recent_" + caregiverId;
        long at = preferences.getLong(key + "_at", 0);
        String id = preferences.getString(key + "_id", null);
        if (id == null || System.currentTimeMillis() - at > 4000) return null;
        JSONObject result = new JSONObject();
        try { result.put("id", id); result.put("at", at); } catch (Exception ignored) {}
        return result;
    }

    void kickAll() {
        File root = new File(context.getFilesDir(), "recording_segments");
        File[] caregivers = root.listFiles(File::isDirectory);
        if (caregivers == null) return;
        for (File caregiver : caregivers) {
            try { kick(Integer.parseInt(caregiver.getName())); }
            catch (NumberFormatException ignored) {}
        }
    }

    void kick(int caregiverId) {
        try {
            for (File directory : SegmentStore.directories(context, caregiverId)) {
                String id = directory.getName();
                JSONObject manifest;
                synchronized (SegmentStore.LOCK) {
                    try { manifest = SegmentStore.read(directory); } catch (Exception ignored) { continue; }
                }
                if (manifest.optBoolean("uploaded") || manifest.optBoolean("uploadCompleted") ||
                    manifest.optInt("segmentCount") == 0 || manifest.optString("uploadError", "").length() > 0) continue;
                String key = caregiverId + "|" + id;
                synchronized (this) {
                    if (paused.contains(key) || System.currentTimeMillis() < retryAt.getOrDefault(key, 0L)) continue;
                    if (!running.add(key)) { rerun.add(key); continue; }
                }
                control.execute(() -> run(key, directory, caregiverId));
            }
        } catch (IOException ignored) { /* The next foreground scan can retry. */ }
    }

    boolean hasRunnablePending() {
        File root = new File(context.getFilesDir(), "recording_segments");
        File[] caregivers = root.listFiles(File::isDirectory);
        if (caregivers == null) return false;
        for (File caregiver : caregivers) {
            File[] recordings = caregiver.listFiles(File::isDirectory);
            if (recordings == null) continue;
            for (File directory : recordings) {
                synchronized (SegmentStore.LOCK) {
                    try {
                        JSONObject manifest = SegmentStore.read(directory);
                        if (!manifest.optBoolean("uploaded") && !manifest.optBoolean("uploadCompleted") &&
                            manifest.optInt("segmentCount") > 0 &&
                            manifest.optString("uploadError", "").isEmpty() &&
                            !isPaused(manifest.optInt("caregiverId") + "|" + manifest.optString("id"))) return true;
                    } catch (Exception ignored) {}
                }
            }
        }
        return false;
    }

    synchronized void pause(int caregiverId, String id) { paused.add(caregiverId + "|" + id); }

    void resume(int caregiverId, String id) {
        synchronized (this) { paused.remove(caregiverId + "|" + id); }
        kick(caregiverId);
    }

    private synchronized boolean isPaused(String key) { return paused.contains(key); }

    private void run(String key, File directory, int caregiverId) {
        try {
            process(key, directory);
            synchronized (this) { retryCount.remove(key); retryAt.remove(key); }
        } catch (Exception error) {
            if (isPaused(key)) return;
            if (!(error instanceof IOException) ||
                (error instanceof UploadFailure && !((UploadFailure) error).retryable)) {
                synchronized (SegmentStore.LOCK) {
                    try {
                        JSONObject manifest = SegmentStore.read(directory);
                        manifest.put("uploadError", error.getMessage() == null
                            ? "Recording upload failed" : error.getMessage());
                        SegmentStore.write(directory, manifest);
                    } catch (Exception ignored) {}
                }
            } else {
                long delay;
                synchronized (this) {
                    int attempts = Math.min(8, retryCount.getOrDefault(key, 0) + 1);
                    retryCount.put(key, attempts);
                    delay = Math.min(300_000L, 1000L << attempts);
                    retryAt.put(key, System.currentTimeMillis() + delay);
                }
                retries.schedule(() -> kick(caregiverId), delay, TimeUnit.MILLISECONDS);
            }
        } finally {
            boolean again;
            synchronized (this) { running.remove(key); again = rerun.remove(key); }
            if (again) kick(caregiverId);
            SegmentedAudioService.stopWhenUploadIdle();
        }
    }

    private void process(String key, File directory) throws Exception {
        while (!isPaused(key)) {
            JSONObject manifest = read(directory);
            if (manifest.optBoolean("uploaded") || manifest.optBoolean("uploadCompleted")) return;
            int caregiverId = manifest.getInt("caregiverId");
            if (!manifest.optBoolean("stopped") &&
                !SegmentedAudioService.isCapturing(caregiverId, manifest.optString("id"))) {
                synchronized (SegmentStore.LOCK) {
                    manifest = SegmentStore.read(directory);
                    File partial = SegmentStore.segment(directory, manifest.optInt("segmentCount"));
                    if (partial.exists() && !partial.delete()) throw new IOException("Cannot discard partial segment");
                    manifest.put("stopped", true);
                    SegmentStore.write(directory, manifest);
                }
            }
            if (manifest.optInt("segmentCount") == 0) return;
            String sessionId = manifest.isNull("sessionId") ? "" : manifest.optString("sessionId", "");
            if (sessionId.isEmpty()) {
                JSONObject body = new JSONObject();
                body.put("date", manifest.getString("date"));
                body.put("caregiverId", caregiverId);
                body.put("childId", 1);
                body.put("chunkFormat", "standalone");
                JSONObject created = request("POST", "/recordings/sessions", body, null);
                sessionId = created.optString("sessionId", "");
                if (sessionId.isEmpty() || created.optInt("caregiverId") != caregiverId ||
                    !manifest.getString("date").equals(created.optString("date")) ||
                    !"standalone".equals(created.optString("chunkFormat")) ||
                    !"recording".equals(created.optString("status")))
                    throw new UploadFailure("Invalid recording session response", false);
                synchronized (SegmentStore.LOCK) {
                    manifest = SegmentStore.read(directory);
                    manifest.put("sessionId", sessionId);
                    SegmentStore.write(directory, manifest);
                }
            }
            int first = manifest.optInt("nextChunkIndex");
            int count = manifest.optInt("segmentCount");
            Set<Integer> acknowledged = indexes(manifest.optJSONArray("confirmedChunkIndexes"));
            List<Integer> batch = new ArrayList<>();
            for (int index = first; index < count && batch.size() < 4; index++) {
                if (!acknowledged.contains(index)) batch.add(index);
            }
            if (!batch.isEmpty()) {
                ExecutorCompletionService<Integer> completed = new ExecutorCompletionService<>(chunks);
                for (int index : batch) {
                    final String targetSession = sessionId;
                    completed.submit(() -> {
                        File file = SegmentStore.segment(directory, index);
                        if (!file.isFile() || file.length() == 0) throw new UploadFailure("Saved audio chunk is unavailable", false);
                        JSONObject result = request("POST", "/recordings/sessions/" + targetSession +
                            "/chunks?chunkIndex=" + index + "&mimeType=audio%2Fwav", null, file);
                        if (!targetSession.equals(result.optString("sessionId")) || result.optInt("chunkIndex", -1) != index)
                            throw new UploadFailure("Invalid recording chunk response", false);
                        return index;
                    });
                }
                Exception failure = null;
                for (int n = 0; n < batch.size(); n++) {
                    try {
                        int index = completed.take().get();
                        if (!isPaused(key)) acknowledge(directory, sessionId, index);
                    } catch (ExecutionException error) {
                        if (failure == null) failure = error.getCause() instanceof Exception
                            ? (Exception) error.getCause() : new IOException(error.getCause());
                    }
                }
                if (failure != null) {
                    if (failure instanceof UploadFailure && ((UploadFailure) failure).status == 404) {
                        resetSession(directory);
                        continue;
                    }
                    if (failure instanceof UploadFailure && ((UploadFailure) failure).status == 409 &&
                        reconcileCompleted(directory, sessionId)) return;
                    throw failure;
                }
                continue;
            }
            if (!manifest.optBoolean("stopped")) return;
            if (first != count || count < 1) throw new UploadFailure("Saved audio is incomplete", false);
            JSONObject body = new JSONObject();
            body.put("finalChunkIndex", count - 1);
            body.put("durationSeconds", Math.max(1, (int) Math.ceil(manifest.optDouble("durationSeconds"))));
            JSONObject result;
            try { result = request("POST", "/recordings/sessions/" + sessionId + "/complete", body, null); }
            catch (UploadFailure error) {
                if (error.status == 409 && reconcileCompleted(directory, sessionId)) return;
                if (error.status == 404) { resetSession(directory); continue; }
                throw error;
            }
            if (!matchesCompleted(result, manifest, sessionId))
                throw new UploadFailure("Recording completion was not confirmed", false);
            finish(directory);
            return;
        }
    }

    private boolean reconcileCompleted(File directory, String sessionId) throws Exception {
        JSONObject remote = request("GET", "/recordings/sessions/" + sessionId, null, null);
        JSONObject local = read(directory);
        if (!sessionId.equals(local.optString("sessionId")) ||
            remote.optInt("caregiverId") != local.optInt("caregiverId") ||
            !remote.optString("date").equals(local.optString("date")) ||
            !"standalone".equals(remote.optString("chunkFormat")))
            throw new UploadFailure("Recording session does not match this audio", false);
        if (!"completed".equals(remote.optString("status"))) return false;
        if (!matchesCompleted(remote, local, sessionId))
            throw new UploadFailure("Completed session does not match this audio", false);
        finish(directory);
        return true;
    }

    private static boolean matchesCompleted(JSONObject remote, JSONObject local, String sessionId) {
        return sessionId.equals(remote.optString("sessionId")) &&
            remote.optInt("caregiverId") == local.optInt("caregiverId") &&
            remote.optString("date").equals(local.optString("date")) &&
            "standalone".equals(remote.optString("chunkFormat")) &&
            "completed".equals(remote.optString("status")) &&
            remote.optInt("uploadedChunks", -1) == local.optInt("segmentCount") &&
            remote.optInt("lastChunkIndex", -2) == local.optInt("segmentCount") - 1;
    }

    private void finish(File directory) throws Exception {
        JSONObject manifest;
        synchronized (SegmentStore.LOCK) {
            manifest = SegmentStore.read(directory);
            manifest.put("uploadCompleted", true);
            manifest.put("uploaded", true);
            manifest.remove("uploadError");
            SegmentStore.write(directory, manifest);
        }
        String id = manifest.getString("id");
        int caregiverId = manifest.getInt("caregiverId");
        preferences.edit().putString("recent_" + caregiverId + "_id", id)
            .putLong("recent_" + caregiverId + "_at", System.currentTimeMillis()).apply();
        SegmentedAudioService.clearInterruption(caregiverId, id);
        SegmentedAudioPlugin.notifyUploadCompleted(manifest);
        synchronized (SegmentStore.LOCK) {
            try { SegmentStore.deleteTree(directory); }
            catch (IOException ignored) { /* getPendingUploads retries uploaded manifests. */ }
        }
    }

    private void acknowledge(File directory, String sessionId, int index) throws Exception {
        synchronized (SegmentStore.LOCK) {
            JSONObject manifest = SegmentStore.read(directory);
            if (!sessionId.equals(manifest.optString("sessionId"))) return;
            Set<Integer> pending = indexes(manifest.optJSONArray("confirmedChunkIndexes"));
            pending.add(index);
            int next = manifest.optInt("nextChunkIndex");
            while (pending.remove(next)) next++;
            JSONArray array = new JSONArray();
            for (int value : pending) array.put(value);
            manifest.put("confirmedChunkIndexes", array);
            manifest.put("nextChunkIndex", next);
            SegmentStore.write(directory, manifest);
        }
    }

    private static Set<Integer> indexes(JSONArray values) {
        Set<Integer> result = new HashSet<>();
        if (values != null) for (int n = 0; n < values.length(); n++) result.add(values.optInt(n));
        return result;
    }

    private void resetSession(File directory) throws Exception {
        synchronized (SegmentStore.LOCK) {
            JSONObject manifest = SegmentStore.read(directory);
            manifest.put("sessionId", JSONObject.NULL);
            manifest.put("nextChunkIndex", 0);
            manifest.put("confirmedChunkIndexes", new JSONArray());
            SegmentStore.write(directory, manifest);
        }
    }

    private JSONObject read(File directory) throws Exception {
        synchronized (SegmentStore.LOCK) { return SegmentStore.read(directory); }
    }

    private JSONObject request(String method, String path, JSONObject body, File file) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(
            preferences.getString("apiBase", DEFAULT_API) + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(120_000);
        try {
            if (body != null || file != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", file == null ? "application/json" : "audio/wav");
                long size = file == null ? body.toString().getBytes(StandardCharsets.UTF_8).length : file.length();
                connection.setFixedLengthStreamingMode(size);
                try (OutputStream output = connection.getOutputStream()) {
                    if (file == null) output.write(body.toString().getBytes(StandardCharsets.UTF_8));
                    else try (InputStream input = new FileInputStream(file)) {
                        byte[] buffer = new byte[16_384];
                        for (int n; (n = input.read(buffer)) != -1;) output.write(buffer, 0, n);
                    }
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            ByteArrayOutputStream response = new ByteArrayOutputStream();
            if (stream != null) try (InputStream input = stream) {
                byte[] buffer = new byte[4096];
                for (int n; (n = input.read(buffer)) != -1;) {
                    if (response.size() > 64_000) throw new IOException("Recording response is too large");
                    response.write(buffer, 0, n);
                }
            }
            JSONObject result;
            try { result = new JSONObject(response.toString(StandardCharsets.UTF_8.name())); }
            catch (Exception error) { throw new IOException("Invalid recording server response", error); }
            if (status < 200 || status >= 300) {
                throw new UploadFailure(result.optString("detail", "Recording request failed (HTTP " + status + ")"),
                    status, status == 408 || status == 429 || status >= 500);
            }
            return result;
        } finally { connection.disconnect(); }
    }

    private static final class UploadFailure extends IOException {
        final int status;
        final boolean retryable;
        UploadFailure(String message, boolean retryable) { this(message, 0, retryable); }
        UploadFailure(String message, int status, boolean retryable) {
            super(message); this.status = status; this.retryable = retryable;
        }
    }
}
