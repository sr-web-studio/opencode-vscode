package dev.srwebstudio.opencode;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.srwebstudio.opencode.notify.BackgroundNotifyPlugin;
import dev.srwebstudio.opencode.notify.WatchState;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Local plugins must be registered before the bridge is created.
    registerPlugin(BackgroundNotifyPlugin.class);
    super.onCreate(savedInstanceState);
  }

  // The watching service does not notify for the session on screen, but only while the app is really in front.
  @Override
  public void onStart() {
    super.onStart();
    WatchState.setForeground(true);
  }

  @Override
  public void onStop() {
    WatchState.setForeground(false);
    super.onStop();
  }
}
