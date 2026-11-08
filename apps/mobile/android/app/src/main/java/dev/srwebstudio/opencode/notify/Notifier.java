package dev.srwebstudio.opencode.notify;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import dev.srwebstudio.opencode.MainActivity;
import dev.srwebstudio.opencode.R;

/**
 * Channels and notifications. One notification per session (tag = server + session, so a new one replaces the old
 * one), grouped per server, with the server's name as sub-text. A tap opens
 * {@code opencode-mobile://session/<id>?server=<serverId>} in the app.
 */
public final class Notifier {
  public static final String CH_INPUT = "needs_input";
  public static final String CH_FINISHED = "turn_finished";
  public static final String CH_WORKERS = "workers";
  public static final String CH_CONNECTION = "connection";
  public static final int ONGOING_ID = 1001;

  private final Context ctx;

  public Notifier(Context context) {
    this.ctx = context.getApplicationContext();
    createChannels();
  }

  private void createChannels() {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    nm.createNotificationChannel(channel(CH_INPUT, "Needs input", "A session asks for permission or has a question.", NotificationManager.IMPORTANCE_HIGH));
    nm.createNotificationChannel(channel(CH_FINISHED, "Turn finished", "A session finished its turn, or failed.", NotificationManager.IMPORTANCE_DEFAULT));
    nm.createNotificationChannel(channel(CH_WORKERS, "Workers", "A worker (child session) ended its turn.", NotificationManager.IMPORTANCE_LOW));
    NotificationChannel conn = channel(CH_CONNECTION, "Connection", "Shows that the app is watching your servers.", NotificationManager.IMPORTANCE_MIN);
    conn.setShowBadge(false);
    nm.createNotificationChannel(conn);
  }

  private static NotificationChannel channel(String id, String name, String description, int importance) {
    NotificationChannel c = new NotificationChannel(id, name, importance);
    c.setDescription(description);
    return c;
  }

  static String channelFor(Kind kind) {
    if (kind.attention) return CH_INPUT;
    return kind == Kind.WORKER ? CH_WORKERS : CH_FINISHED;
  }

  static String tag(String serverId, String sessionID) {
    return serverId + "|" + sessionID;
  }

  private PendingIntent open(String deepLink, int requestCode) {
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(deepLink), ctx, MainActivity.class);
    i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  public void show(Notice n) {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return;
    String tag = tag(n.server.id, n.sessionID);
    NotificationCompat.Builder b =
        new NotificationCompat.Builder(ctx, channelFor(n.kind))
            .setSmallIcon(R.drawable.ic_stat_opencode)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setSubText(n.server.name)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(n.body))
            .setContentIntent(open(n.deepLink(), tag.hashCode()))
            .setAutoCancel(true)
            .setShowWhen(true)
            .setGroup("server:" + n.server.id)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
            .setCategory(n.kind.attention ? NotificationCompat.CATEGORY_MESSAGE : NotificationCompat.CATEGORY_STATUS)
            .setPriority(n.kind.attention ? NotificationCompat.PRIORITY_HIGH : n.kind == Kind.WORKER ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion(n));
    if (n.kind.attention) b.setDefaults(NotificationCompat.DEFAULT_ALL);
    try {
      NotificationManagerCompat.from(ctx).notify(tag, 1, b.build());
    } catch (SecurityException e) {
      // POST_NOTIFICATIONS was revoked a moment ago: nothing to show.
    }
  }

  /** The lock-screen version when the phone hides sensitive content: says what happened, not where. */
  private Notification publicVersion(Notice n) {
    String what = n.kind == Kind.PERMISSION ? "needs permission" : n.kind == Kind.QUESTION ? "has a question" : n.kind == Kind.FAILED ? "failed" : "finished";
    return new NotificationCompat.Builder(ctx, channelFor(n.kind))
        .setSmallIcon(R.drawable.ic_stat_opencode)
        .setContentTitle("A session " + what)
        .setSubText(n.server.name)
        .build();
  }

  public void cancel(String serverId, String sessionID) {
    NotificationManagerCompat.from(ctx).cancel(tag(serverId, sessionID), 1);
  }

  /** The ongoing "Watching N servers" notification. */
  public Notification ongoing(int connected, int total, boolean allowed) {
    String text;
    if (total == 0) text = "No servers to watch";
    else if (connected == total) text = "Watching " + total + (total == 1 ? " server" : " servers");
    else text = "Watching " + total + (total == 1 ? " server" : " servers") + " (" + connected + " connected)";
    Intent i = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent pi = PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    return new NotificationCompat.Builder(ctx, CH_CONNECTION)
        .setSmallIcon(R.drawable.ic_stat_opencode)
        .setContentTitle("OpenCode")
        .setContentText(text)
        .setContentIntent(pi)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build();
  }

  public void updateOngoing(int connected, int total) {
    try {
      NotificationManagerCompat.from(ctx).notify(ONGOING_ID, ongoing(connected, total, true));
    } catch (SecurityException ignored) {
      // no notification permission: the service still runs
    }
  }
}
