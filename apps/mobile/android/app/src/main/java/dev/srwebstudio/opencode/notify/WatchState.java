package dev.srwebstudio.opencode.notify;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What the service and the app's screens share inside one process: which server is connected (and why not), when the
 * last event came, and which session the owner is looking at right now. No secrets: a failure reason is kept only
 * as the short text of the stream's exception, and the notification shows fixed phrases ({@link StatusText}).
 */
public final class WatchState {
  private WatchState() {}

  private static final class Link {
    String name;
    boolean connected;
    /** Why the last attempt ended; null until one has ended. */
    String reason;
    long downSince;

    Link(String name) {
      this.name = name;
    }
  }

  private static final Object LOCK = new Object();
  private static final Map<String, Link> LINKS = new LinkedHashMap<>();
  private static volatile boolean running;
  private static volatile long lastEventAt;
  private static volatile boolean foreground;
  private static volatile String visibleServerId;
  private static volatile String visibleSessionID;

  public static boolean running() {
    return running;
  }

  public static void setRunning(boolean value) {
    running = value;
    if (!value) {
      synchronized (LOCK) {
        LINKS.clear();
      }
    }
  }

  public static void setServers(List<ServerRef> servers) {
    synchronized (LOCK) {
      Map<String, Link> keep = new LinkedHashMap<>();
      for (ServerRef s : servers) {
        Link old = LINKS.get(s.id);
        Link l = old != null ? old : new Link(s.name);
        l.name = s.name;
        keep.put(s.id, l);
      }
      LINKS.clear();
      LINKS.putAll(keep);
    }
  }

  public static void setUp(String serverId) {
    synchronized (LOCK) {
      Link l = LINKS.get(serverId);
      if (l == null) return;
      l.connected = true;
      l.reason = null;
      l.downSince = 0;
    }
  }

  /** The stream ended or could not connect. {@code reason} may be null (stopped by the service itself). */
  public static void setDown(String serverId, String reason, long now) {
    synchronized (LOCK) {
      Link l = LINKS.get(serverId);
      if (l == null) return;
      // The first failure of this outage starts the clock; later failed attempts keep it.
      if (l.connected || l.downSince == 0) l.downSince = now;
      l.connected = false;
      l.reason = reason;
    }
  }

  public static int connectedCount() {
    synchronized (LOCK) {
      int n = 0;
      for (Link l : LINKS.values()) if (l.connected) n++;
      return n;
    }
  }

  public static int serverCount() {
    synchronized (LOCK) {
      return LINKS.size();
    }
  }

  /** Per server: id, name, connected. */
  public static List<Object[]> servers() {
    synchronized (LOCK) {
      List<Object[]> out = new ArrayList<>();
      for (Map.Entry<String, Link> e : LINKS.entrySet()) out.add(new Object[] {e.getKey(), e.getValue().name, e.getValue().connected});
      return out;
    }
  }

  /** What the ongoing notification is built from. */
  public static List<StatusText.ServerStatus> statuses() {
    synchronized (LOCK) {
      List<StatusText.ServerStatus> out = new ArrayList<>();
      for (Link l : LINKS.values()) out.add(new StatusText.ServerStatus(l.name, l.connected, l.reason, l.downSince));
      return out;
    }
  }

  public static long lastEventAt() {
    return lastEventAt;
  }

  public static void touchEvent(long at) {
    lastEventAt = at;
  }

  /** The app's activity is in the foreground (set from MainActivity). */
  public static void setForeground(boolean value) {
    foreground = value;
  }

  public static void setVisible(String serverId, String sessionID) {
    visibleServerId = serverId == null || serverId.isEmpty() ? null : serverId;
    visibleSessionID = sessionID == null || sessionID.isEmpty() ? null : sessionID;
  }

  /** True only while the app is in front and this exact session is on screen. */
  public static boolean isVisible(String serverId, String sessionID) {
    return foreground && visibleSessionID != null && visibleSessionID.equals(sessionID) && serverId != null && serverId.equals(visibleServerId);
  }
}
