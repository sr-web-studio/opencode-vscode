package dev.srwebstudio.opencode.notify;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * After a reboot or an app update, start watching again when the owner has notifications on and a server is saved.
 * A {@code specialUse} foreground service is allowed to start from {@code BOOT_COMPLETED}; the restricted types are
 * dataSync, mediaPlayback, phoneCall, mediaProjection, camera and microphone.
 */
public final class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    String a = intent == null ? null : intent.getAction();
    if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
    Vault vault = new Vault(context);
    if (!vault.loadSettings().enabled || vault.loadProfiles().isEmpty()) return;
    WatchService.start(context, WatchService.START);
  }
}
