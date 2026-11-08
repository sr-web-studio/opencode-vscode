package dev.srwebstudio.opencode.notify;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What the service and the app's screens share inside one process: which server is connected, when the last event came,
 * and which session the owner is looking at right now. No secrets.
 */
public final class WatchState {
  private WatchState() {}

  private static final Object LOCK = new Object();
  private static final Map<String, Boolean> CONNECTED = new LinkedHashMap<>();
  private static final Map<String, String> NAMES = new LinkedHashMap<>();
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
        CONNECTED.clear();
        NAMES.clear();
      }
    }
  }

  public static void setServers(java.util.List<ServerRef> servers) {
    synchronized (LOCK) {
      Map<String, Boolean> keep = new LinkedHashMap<>();
      NAMES.clear();
      for (ServerRef s : servers) {
        keep.put(s.id, Boolean.TRUE.equals(CONNECTED.get(s.id)));
        NAMES.put(s.id, s.name);
      }
      CONNECTED.clear();
      CONNECTED.putAll(keep);
    }
  }

  public static void setConnected(String serverId, boolean connected) {
    synchronized (LOCK) {
      if (NAMES.containsKey(serverId)) CONNECTED.put(serverId, connected);
    }
  }

  public static int connectedCount() {
    synchronized (LOCK) {
      int n = 0;
      for (Boolean b : CONNECTED.values()) if (b) n++;
      return n;
    }
  }

  public static int serverCount() {
    synchronized (LOCK) {
      return CONNECTED.size();
    }
  }

  /** Per server: id, name, connected. */
  public static java.util.List<Object[]> servers() {
    synchronized (LOCK) {
      java.util.List<Object[]> out = new java.util.ArrayList<>();
      for (Map.Entry<String, Boolean> e : CONNECTED.entrySet()) out.add(new Object[] {e.getKey(), NAMES.get(e.getKey()), e.getValue()});
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
