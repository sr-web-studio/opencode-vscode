package dev.srwebstudio.opencode.notify;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/**
 * The foreground service that keeps one event stream per saved server, independent of the WebView. It starts from the
 * app (or at boot, or after the app was updated), reads the servers from the {@link Vault} and runs until the owner
 * switches background notifications off. No polling and no wake lock: it sits on blocked sockets, which the phone
 * wakes for when the server sends something.
 */
public final class WatchService extends Service {
  private static final String TAG = "OccWatch";
  public static final String ACTION_START = "dev.srwebstudio.opencode.notify.START";
  public static final String ACTION_RELOAD = "dev.srwebstudio.opencode.notify.RELOAD";

  private static final class Watch {
    final EventStream stream;
    final Thread thread;
    final ServerRef server;

    Watch(EventStream stream, Thread thread, ServerRef server) {
      this.stream = stream;
      this.thread = thread;
      this.server = server;
    }
  }

  private final Map<String, Watch> watches = new HashMap<>();
  private Vault vault;
  private Notifier notifier;
  private NoticeEngine engine;
  private ConnectivityManager connectivity;
  private ConnectivityManager.NetworkCallback networkCallback;
  private boolean firstNetworkCallback;

  /** Start (or reload) the service from anywhere that is allowed to: the app in front, boot, package replaced. */
  public static void start(Context context, String action) {
    Intent i = new Intent(context, WatchService.class).setAction(action);
    try {
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
      else context.startService(i);
    } catch (RuntimeException e) {
      // Not allowed right now (background start limits): the app starts it the next time it is in front.
      Log.w(TAG, "service start refused: " + e.getClass().getSimpleName());
    }
  }

  public static void stop(Context context) {
    context.stopService(new Intent(context, WatchService.class));
  }

  @Override
  public void onCreate() {
    super.onCreate();
    vault = new Vault(this);
    notifier = new Notifier(this);
    connectivity = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
    final Context app = getApplicationContext();
    engine =
        new NoticeEngine(
            new NoticeEngine.Deps() {
              @Override
              public SessionMeta session(ServerRef server, String sessionID) throws Exception {
                return SessionApi.get(server, sessionID);
              }

              @Override
              public String lastAnswer(ServerRef server, String sessionID) throws Exception {
                return SessionApi.lastAnswer(server, sessionID);
              }

              @Override
              public int profileCount() {
                return WatchState.serverCount();
              }

              @Override
              public void show(Notice notice) {
                notifier.show(notice);
                Log.i(TAG, "notified " + notice.kind + " session " + notice.sessionID);
              }

              @Override
              public void cancel(ServerRef server, String sessionID) {
                notifier.cancel(server.id, sessionID);
              }

              @Override
              public Settings settings() {
                return vault.loadSettings();
              }

              @Override
              public boolean isVisible(ServerRef server, String sessionID) {
                // The app knows its server by serverId (the deep-link name), the service by profile id: both are compared.
                return WatchState.isVisible(server.serverId, sessionID) || WatchState.isVisible(server.id, sessionID);
              }

              @Override
              public void seenChanged(String serialized) {
                vault.saveSeen(serialized);
              }

              @Override
              public long now() {
                return System.currentTimeMillis();
              }

              @Override
              public void log(String line) {
                Log.i(TAG, line);
              }
            },
            vault.loadSeen());
    watchNetwork();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    List<ServerRef> servers = vault.loadProfiles();
    if (!vault.loadSettings().enabled || servers.isEmpty()) {
      // Show the notification the system demands for a started foreground service, then leave.
      goForeground(notifier.ongoing(0, 0, true));
      stopForeground(STOP_FOREGROUND_REMOVE);
      stopSelf();
      return START_NOT_STICKY;
    }
    goForeground(notifier.ongoing(WatchState.connectedCount(), servers.size(), true));
    WatchState.setRunning(true);
    reconcile(servers);
    return START_STICKY;
  }

  private void goForeground(Notification n) {
    if (Build.VERSION.SDK_INT >= 34) startForeground(Notifier.ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
    else startForeground(Notifier.ONGOING_ID, n);
  }

  /** Make the running streams match the saved servers: start new ones, restart changed ones, stop removed ones. */
  private synchronized void reconcile(List<ServerRef> servers) {
    WatchState.setServers(servers);
    Map<String, ServerRef> wanted = new HashMap<>();
    for (ServerRef s : servers) wanted.put(s.id, s);
    for (String id : new ArrayList<>(watches.keySet())) {
      Watch w = watches.get(id);
      ServerRef want = wanted.get(id);
      if (want == null || !want.sameConnection(w.server)) {
        w.stream.stop();
        watches.remove(id);
      }
    }
    for (ServerRef s : servers) {
      if (watches.containsKey(s.id)) continue;
      final EventStream stream = new EventStream(s, new HttpTransport(), listener(), new EventStream.MonitorSleeper());
      Thread t = new Thread(stream::run, "occ-watch-" + s.id);
      t.setDaemon(true);
      watches.put(s.id, new Watch(stream, t, s));
      t.start();
    }
    refreshOngoing();
  }

  private EventStream.Listener listener() {
    return new EventStream.Listener() {
      @Override
      public void onConnected(ServerRef server) {
        WatchState.setConnected(server.id, true);
        Log.i(TAG, "connected " + server);
        refreshOngoing();
      }

      @Override
      public void onEvent(ServerRef server, JSONObject event) {
        WatchState.touchEvent(System.currentTimeMillis());
        engine.handle(server, event);
      }

      @Override
      public void onDisconnected(ServerRef server, String reason) {
        WatchState.setConnected(server.id, false);
        Log.i(TAG, "disconnected " + server + ": " + reason);
        refreshOngoing();
      }

      @Override
      public void onActivity(ServerRef server) {}
    };
  }

  private void refreshOngoing() {
    notifier.updateOngoing(WatchState.connectedCount(), WatchState.serverCount());
  }

  /** A new network (Wi-Fi to mobile data, or back) kills the old socket without a word: reconnect at once. */
  private void watchNetwork() {
    if (connectivity == null) return;
    firstNetworkCallback = true;
    networkCallback =
        new ConnectivityManager.NetworkCallback() {
          @Override
          public void onAvailable(Network network) {
            if (firstNetworkCallback) {
              // The callback fires once on registration with the current network: nothing changed yet.
              firstNetworkCallback = false;
              return;
            }
            Log.i(TAG, "network changed: reconnecting");
            synchronized (WatchService.this) {
              for (Watch w : watches.values()) w.stream.kick();
            }
          }
        };
    try {
      connectivity.registerDefaultNetworkCallback(networkCallback);
    } catch (RuntimeException e) {
      networkCallback = null;
      Log.w(TAG, "no network callback: " + e.getClass().getSimpleName());
    }
  }

  @Override
  public void onDestroy() {
    if (connectivity != null && networkCallback != null) {
      try {
        connectivity.unregisterNetworkCallback(networkCallback);
      } catch (RuntimeException ignored) {
        // already gone
      }
    }
    synchronized (this) {
      for (Watch w : watches.values()) w.stream.stop();
      watches.clear();
    }
    WatchState.setRunning(false);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
