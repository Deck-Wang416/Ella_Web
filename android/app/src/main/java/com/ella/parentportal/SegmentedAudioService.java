package com.ella.parentportal;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.UUID;

public class SegmentedAudioService extends Service {
    static final String ACTION_START = "com.ella.parentportal.RECORD_START";
    static final String ACTION_STOP = "com.ella.parentportal.RECORD_STOP";
    static final String EXTRA_ID = "id";
    static final String EXTRA_DATE = "date";
    static final String EXTRA_CAREGIVER = "caregiverId";
    private static final String CHANNEL = "ella_recording";
    private static final int NOTIFICATION_ID = 41;
    private static final int SAMPLE_RATE = 44_100;
    private static final int BYTES_PER_SECOND = SAMPLE_RATE * 2;
    private static final int SEGMENT_BYTES = BYTES_PER_SECOND * 3;

    private static volatile String activeId;
    private static volatile int activeCaregiver;
    private static volatile long startedAt;
    private static volatile String lastError;
    private static volatile int lastErrorCaregiver;
    private volatile boolean stopRequested;
    private AudioRecord recorder;
    private Thread captureThread;

    static boolean isCapturing(int caregiverId, String id) {
        return activeCaregiver == caregiverId && id != null && id.equals(activeId);
    }

    static String activeRecordingId(int caregiverId) {
        return activeCaregiver == caregiverId ? activeId : null;
    }

    static boolean hasActiveRecording() { return activeId != null; }
    static boolean wasInterrupted(int caregiverId) {
        return lastError != null && lastErrorCaregiver == caregiverId;
    }

    static double elapsedSeconds(int caregiverId) {
        return activeCaregiver == caregiverId && startedAt > 0
            ? (SystemClock.elapsedRealtime() - startedAt) / 1000.0 : 0;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            if (isCapturing(intent.getIntExtra(EXTRA_CAREGIVER, 0), intent.getStringExtra(EXTRA_ID))) {
                stopRequested = true;
                try { if (recorder != null) recorder.stop(); } catch (IllegalStateException ignored) {}
            }
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction()) || activeId != null) return START_NOT_STICKY;
        int caregiverId = intent.getIntExtra(EXTRA_CAREGIVER, 0);
        String date = intent.getStringExtra(EXTRA_DATE);
        String id = intent.getStringExtra(EXTRA_ID);
        if (caregiverId <= 0 || date == null || id == null) { stopSelf(); return START_NOT_STICKY; }
        try { UUID.fromString(id); } catch (IllegalArgumentException error) { stopSelf(); return START_NOT_STICKY; }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf(); return START_NOT_STICKY;
        }
        createNotificationChannel();
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= 30) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        stopRequested = false;
        lastError = null;
        lastErrorCaregiver = 0;
        activeId = id;
        activeCaregiver = caregiverId;
        startedAt = SystemClock.elapsedRealtime();
        captureThread = new Thread(() -> capture(caregiverId, date, id), "EllaAudioCapture");
        captureThread.start();
        return START_NOT_STICKY;
    }

    private void capture(int caregiverId, String date, String id) {
        File directory = null;
        RandomAccessFile current = null;
        File currentFile = null;
        int written = 0;
        try {
            directory = SegmentStore.folder(this, caregiverId, id);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create recording directory");
            JSONObject manifest = new JSONObject();
            manifest.put("id", id);
            manifest.put("caregiverId", caregiverId);
            manifest.put("date", date);
            manifest.put("sessionId", JSONObject.NULL);
            manifest.put("nextChunkIndex", 0);
            manifest.put("segmentCount", 0);
            manifest.put("durationSeconds", 0);
            manifest.put("stopped", false);
            manifest.put("uploaded", false);
            synchronized (SegmentStore.LOCK) { SegmentStore.write(directory, manifest); }

            int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT);
            if (minBuffer <= 0) throw new IOException("Microphone format is unavailable");
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuffer * 2, 8192));
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("Microphone failed to initialize");
            recorder.startRecording();
            byte[] buffer = new byte[8192];
            while (!stopRequested) {
                int count = recorder.read(buffer, 0, buffer.length);
                if (count < 0) break;
                if (count == 0) continue;
                if (current == null) {
                    synchronized (SegmentStore.LOCK) { manifest = SegmentStore.read(directory); }
                    currentFile = SegmentStore.segment(directory, manifest.getInt("segmentCount"));
                    current = new RandomAccessFile(currentFile, "rw");
                    writeHeader(current, 0);
                    written = 0;
                }
                current.write(buffer, 0, count);
                written += count;
                if (written >= SEGMENT_BYTES) {
                    closeSegment(current, currentFile, written, directory);
                    current = null;
                    currentFile = null;
                    written = 0;
                }
            }
            if (current != null) {
                closeSegment(current, currentFile, written, directory);
                current = null;
            }
            synchronized (SegmentStore.LOCK) {
                manifest = SegmentStore.read(directory);
                manifest.put("stopped", true);
                SegmentStore.write(directory, manifest);
            }
        } catch (Exception error) {
            Log.e("ELLA", "Recording stopped unexpectedly", error);
            lastError = error.getMessage() == null ? "Microphone recording stopped" : error.getMessage();
            lastErrorCaregiver = caregiverId;
            try {
                if (current != null) {
                    if (written > 0 && directory != null) closeSegment(current, currentFile, written, directory);
                    else current.close();
                    current = null;
                }
                if (directory != null) synchronized (SegmentStore.LOCK) {
                    JSONObject manifest = SegmentStore.read(directory);
                    manifest.put("stopped", true);
                    SegmentStore.write(directory, manifest);
                }
            } catch (Exception cleanupError) { Log.e("ELLA", "Could not seal audio segment", cleanupError); }
        } finally {
            if (current != null) try { current.close(); } catch (IOException ignored) {}
            if (recorder != null) {
                try { recorder.stop(); } catch (IllegalStateException ignored) {}
                recorder.release();
                recorder = null;
            }
            activeId = null;
            activeCaregiver = 0;
            startedAt = 0;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private static void closeSegment(RandomAccessFile handle, File file, int bytes, File directory) throws Exception {
        if (bytes <= 0) { handle.close(); if (file != null) file.delete(); return; }
        writeHeader(handle, bytes);
        handle.close();
        synchronized (SegmentStore.LOCK) {
            JSONObject latest = SegmentStore.read(directory);
            latest.put("segmentCount", latest.getInt("segmentCount") + 1);
            latest.put("durationSeconds", latest.optDouble("durationSeconds") + (double) bytes / BYTES_PER_SECOND);
            SegmentStore.write(directory, latest);
        }
    }

    private static void writeHeader(RandomAccessFile file, int bytes) throws IOException {
        file.seek(0);
        file.writeBytes("RIFF");
        little(file, 36 + bytes, 4);
        file.writeBytes("WAVEfmt ");
        little(file, 16, 4);
        little(file, 1, 2);
        little(file, 1, 2);
        little(file, SAMPLE_RATE, 4);
        little(file, BYTES_PER_SECOND, 4);
        little(file, 2, 2);
        little(file, 16, 2);
        file.writeBytes("data");
        little(file, bytes, 4);
        file.seek(44L + bytes);
    }

    private static void little(RandomAccessFile file, int value, int count) throws IOException {
        for (int i = 0; i < count; i++) file.write((value >>> (8 * i)) & 0xff);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "ELLA recording", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("ELLA is recording")
            .setContentText("Tap to return to your recording")
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }
}
