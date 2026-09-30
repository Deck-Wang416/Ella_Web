package com.ella.parentportal;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SegmentedAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
