package com.ella.parentportal;

import android.content.Context;
import android.util.AtomicFile;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

final class SegmentStore {
    static final Object LOCK = new Object();

    private SegmentStore() {}

    static File root(Context context, int caregiverId) throws IOException {
        File dir = new File(new File(context.getFilesDir(), "recording_segments"), String.valueOf(caregiverId));
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create recording directory");
        return dir;
    }

    static File folder(Context context, int caregiverId, String id) throws IOException {
        try { UUID.fromString(id); } catch (Exception error) { throw new IOException("Invalid recording id", error); }
        return new File(root(context, caregiverId), id.toLowerCase());
    }

    static File segment(File directory, int index) {
        return new File(directory, String.format(java.util.Locale.US, "chunk_%06d.wav", index));
    }

    static JSONObject read(File directory) throws IOException, JSONException {
        AtomicFile source = new AtomicFile(new File(directory, "manifest.json"));
        try (FileInputStream stream = source.openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = stream.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        }
    }

    static void write(File directory, JSONObject manifest) throws IOException {
        AtomicFile target = new AtomicFile(new File(directory, "manifest.json"));
        FileOutputStream stream = target.startWrite();
        try {
            stream.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
            target.finishWrite(stream);
        } catch (IOException error) {
            target.failWrite(stream);
            throw error;
        }
    }

    static List<File> directories(Context context, int caregiverId) throws IOException {
        File[] found = root(context, caregiverId).listFiles(File::isDirectory);
        List<File> result = new ArrayList<>();
        if (found != null) java.util.Collections.addAll(result, found);
        result.sort(Comparator.comparingLong(File::lastModified));
        return result;
    }

    static JSObject summary(JSONObject manifest) {
        JSObject result = new JSObject();
        result.put("id", manifest.optString("id"));
        result.put("date", manifest.optString("date"));
        result.put("format", "standalone");
        result.put("sessionId", manifest.isNull("sessionId") ? JSONObject.NULL : manifest.optString("sessionId"));
        result.put("nextChunkIndex", manifest.optInt("nextChunkIndex"));
        result.put("segmentCount", manifest.optInt("segmentCount"));
        result.put("stopped", manifest.optBoolean("stopped"));
        result.put("durationSeconds", manifest.optDouble("durationSeconds"));
        result.put("uploaded", manifest.optBoolean("uploaded"));
        return result;
    }

    static void deleteTree(File file) throws IOException {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        if (file.exists() && !file.delete()) throw new IOException("Cannot remove uploaded audio");
    }
}
