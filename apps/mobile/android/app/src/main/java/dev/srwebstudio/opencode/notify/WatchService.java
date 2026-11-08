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
  /**
   * Start reasons. The intent's action is the app's own package name plus one of these, so a test build and the released
   * app never answer each other's broadcasts.
   */
  static final String START = "START";
  static final String RELOAD = "RELOAD";
  /** Started by the {@link Watchdog} after the service was found dead. */
  static final String WATCHDOG_START = "WATCHDOG_START";

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
  /** One thread: catch-ups of different servers queue up instead of piling HTTP calls on a phone that just woke. */
  private final java.util.concurrent.ExecutorService catchUps =
      java.util.concurrent.Executors.newSingleThreadExecutor(
          new java.util.concurrent.ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
              Thread t = new Thread(r, "occ-catchup");
              t.setDaemon(true);
              return t;
            }
          });

  /** Start (or reload) the service from anywhere that is allowed to: the app in front, boot, package replaced. */
  public static boolean start(Context context, String reason) {
    Intent i = new Intent(context, WatchService.class).setAction(context.getPackageName() + ".notify." + reason);
    try {
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
      else context.startService(i);
      return true;
    } catch (RuntimeException e) {
      // Not allowed right now (background start limits): the app starts it the next time it is in front.
      Log.w(TAG, "service start refused: " + e.getClass().getSimpleName());
      return false;
    }
  }

  public static void stop(Context context) {
    Watchdog.cancel(context);
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
              public void pause(long ms) {
                try {
                  Thread.sleep(ms);
                } catch (InterruptedException e) {
                  Thread.currentThread().interrupt();
                }
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
    // intent is null when the system restarts the service after its process died (START_STICKY).
    List<ServerRef> servers = vault.loadProfiles();
    if (!vault.loadSettings().enabled || servers.isEmpty()) {
      // Show the notification the system demands for a started foreground service, then leave.
      goForeground(notifier.ongoing("No servers to watch"));
      stopForeground(STOP_FOREGROUND_REMOVE);
      Watchdog.cancel(this);
      stopSelf();
      return START_NOT_STICKY;
    }
    // Nothing is connected yet: the first text is "Connecting…", never "Watching".
    WatchState.setServers(servers);
    goForeground(notifier.ongoing(StatusText.text(WatchState.statuses(), System.currentTimeMillis())));
    WatchState.setRunning(true);
    Watchdog.schedule(this);
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
        WatchState.setUp(server.id);
        Log.i(TAG, "connected " + server);
        refreshOngoing();
        // The stream is open, so nothing new can slip through; what happened before it opened is read here.
        catchUp(server);
      }

      @Override
      public void onEvent(ServerRef server, JSONObject event) {
        WatchState.touchEvent(System.currentTimeMillis());
        engine.handle(server, event);
      }

      @Override
      public void onDisconnected(ServerRef server, String reason) {
        WatchState.setDown(server.id, reason, System.currentTimeMillis());
        Log.i(TAG, "disconnected " + server + ": " + reason);
        refreshOngoing();
      }

      @Override
      public void onActivity(ServerRef server) {}
    };
  }

  /** Read the open questions and permission requests of this server on a worker thread (HTTP, never on the stream's). */
  private void catchUp(final ServerRef server) {
    try {
      catchUps.execute(
          new Runnable() {
            @Override
            public void run() {
              try {
                engine.catchUp(server, new PendingApi());
              } catch (RuntimeException e) {
                Log.w(TAG, "catch-up failed: " + e.getClass().getSimpleName());
              }
            }
          });
    } catch (java.util.concurrent.RejectedExecutionException ignored) {
      // the service is shutting down
    }
  }

  private void refreshOngoing() {
    notifier.updateOngoing(StatusText.text(WatchState.statuses(), System.currentTimeMillis()));
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
    catchUps.shutdownNow();
    WatchState.setRunning(false);
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
