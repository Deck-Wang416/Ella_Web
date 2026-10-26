package com.ella.parentportal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SegmentedAudioPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            NotificationChannel channel = new NotificationChannel(
                getString(R.string.diary_reminder_channel_id),
                getString(R.string.diary_reminder_channel_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.diary_reminder_channel_description));
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
    }
}
