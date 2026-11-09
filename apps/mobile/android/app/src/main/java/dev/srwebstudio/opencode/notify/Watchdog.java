package dev.srwebstudio.opencode.notify;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationManagerCompat;

/**
 * Brings the watching service back when its process was killed (the system's own sticky restart is not reliable: on
 * the test phone, Android 17 on a Samsung, it did not come back for 5+ minutes). An inexact alarm that allows idle
 * ({@link AlarmManager#setAndAllowWhileIdle}, no permission needed) fires every {@link #PERIOD_MS} while the service
 * runs. The alarm lives in the system, so it survives the death of the app's process; a force-stop or a reboot clears it
 * (the owner's own act, or {@link BootReceiver}).
 *
 * <p>When it fires and the service is not running it starts it. A foreground service may start from the background for
 * an app that the owner took off battery optimisation (the app asks for that once); when the start is refused it
 * replaces the stale "Watching" notification with "Not watching — tap to resume", so the notification never lies, and a
 * tap opens the app, which starts the service (the app in front is allowed to).
 */
public final class Watchdog extends BroadcastReceiver {
  public static final long PERIOD_MS = 15L * 60 * 1000;
  private static final int REQUEST = 7001;

  /** The alarm's action; the app's own package name keeps the test build and the released app apart. */
  private static String action(Context context) {
    return context.getPackageName() + ".notify.WATCHDOG";
  }

  /** What a firing alarm does. */
  public enum Decision {
    /** Notifications are off, or no server is saved, or the owner stopped it: nothing to watch, drop the alarm. */
    STAND_DOWN,
    /** The service is running: just look again later. */
    ALIVE,
    /** It should run and does not: start it. */
    RESTART
  }

  /** Pure: the whole decision. */
  public static Decision decide(boolean enabled, boolean hasServers, boolean notificationsAllowed, boolean running) {
    if (!enabled || !hasServers || !notificationsAllowed) return Decision.STAND_DOWN;
    return running ? Decision.ALIVE : Decision.RESTART;
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null || !action(context).equals(intent.getAction())) return;
    Vault vault = new Vault(context);
    boolean enabled = vault.loadSettings().enabled;
    boolean hasServers = !vault.loadProfiles().isEmpty();
    boolean allowed = NotificationManagerCompat.from(context).areNotificationsEnabled();
    Decision d = decide(enabled, hasServers, allowed, WatchState.running());
    if (d == Decision.STAND_DOWN) {
      cancel(context);
      return;
    }
    schedule(context);
    if (d == Decision.RESTART && !WatchService.start(context, WatchService.WATCHDOG_START)) {
      new Notifier(context).postNotWatching();
    }
  }

  /** (Re)arm the alarm one period from now. Replaces an earlier one. */
  public static void schedule(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    try {
      am.setAndAllowWhileIdle(AlarmManager.RTC, System.currentTimeMillis() + PERIOD_MS, pending(context));
    } catch (RuntimeException ignored) {
      // The platform refused: without a watchdog the service still runs as before.
    }
  }

  public static void cancel(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am != null) am.cancel(pending(context));
  }

  private static PendingIntent pending(Context context) {
    Intent i = new Intent(context, Watchdog.class).setAction(action(context));
    return PendingIntent.getBroadcast(context, REQUEST, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }
}
