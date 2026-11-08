package dev.srwebstudio.opencode.notify;

import java.util.ArrayList;
import java.util.List;

/**
 * The words of the ongoing notification. It must never claim "Watching" while no event stream is connected. Pure: the
 * service passes what it knows ({@link ServerStatus}) and the time, and shows the result.
 *
 * <ul>
 *   <li>all connected: {@code Watching 2 servers}
 *   <li>nothing tried yet: {@code Connecting…}
 *   <li>down for less than {@link #GRACE_MS}: {@code Reconnecting…}
 *   <li>down for longer: {@code Not connected: wrong password}
 *   <li>some connected: {@code Watching 1 of 2 servers · Home: can't reach the server}
 * </ul>
 */
public final class StatusText {
  private StatusText() {}

  /** A dropped connection is "Reconnecting…" for this long, then "Not connected: <reason>". */
  public static final long GRACE_MS = 30_000;

  /** One server as the ongoing notification sees it. */
  public static final class ServerStatus {
    public final String name;
    public final boolean connected;
    /** Why the last attempt ended; null when no attempt has ended yet. Raw text from the stream, never shown as is. */
    public final String reason;
    /** When the connection went down (ms); 0 when it is up or was never tried. */
    public final long downSince;

    public ServerStatus(String name, boolean connected, String reason, long downSince) {
      this.name = name == null ? "" : name;
      this.connected = connected;
      this.reason = reason;
      this.downSince = downSince;
    }
  }

  public static String text(List<ServerStatus> servers, long now) {
    int total = servers.size();
    if (total == 0) return "No servers to watch";
    List<ServerStatus> down = new ArrayList<>();
    for (ServerStatus s : servers) if (!s.connected) down.add(s);
    int up = total - down.size();
    if (down.isEmpty()) return "Watching " + total + (total == 1 ? " server" : " servers");
    if (up == 0) {
      boolean anyFailure = false;
      boolean allInGrace = true;
      for (ServerStatus s : down) {
        if (s.reason != null) anyFailure = true;
        if (s.reason != null && now - s.downSince >= GRACE_MS) allInGrace = false;
      }
      if (!anyFailure) return "Connecting\u2026";
      if (allInGrace) return "Reconnecting\u2026";
      ServerStatus first = firstFailed(down);
      String why = friendlyReason(first.reason);
      return total == 1 ? "Not connected: " + why : "Not connected to " + total + " servers: " + why;
    }
    ServerStatus first = firstFailed(down);
    String detail = first.reason == null || now - first.downSince < GRACE_MS ? "reconnecting\u2026" : friendlyReason(first.reason);
    String name = first.name.isEmpty() ? "a server" : first.name;
    return "Watching " + up + " of " + total + " servers \u00b7 " + name + ": " + detail;
  }

  private static ServerStatus firstFailed(List<ServerStatus> down) {
    for (ServerStatus s : down) if (s.reason != null) return s;
    return down.get(0);
  }

  /**
   * Plain words for a stream failure. The raw message (which can hold an address or a response) is never shown: only
   * these fixed phrases.
   */
  public static String friendlyReason(String raw) {
    if (raw == null) return "connection lost";
    String r = raw.toLowerCase(java.util.Locale.ROOT);
    if (r.contains("http 401") || r.contains("http 403")) return "wrong password";
    if (r.contains("http 5")) return "server error";
    if (r.contains("http 404")) return "not an OpenCode server";
    if (r.contains("http ")) return "server refused";
    if (r.contains("unable to resolve") || r.contains("unknownhost") || r.contains("no address associated")) return "server not found";
    if (r.contains("no data for a while")) return "no answer from the server";
    if (r.contains("refused") || r.contains("failed to connect") || r.contains("unreachable") || r.contains("timed out") || r.contains("timeout")) {
      return "can't reach the server";
    }
    return "connection lost";
  }
}
