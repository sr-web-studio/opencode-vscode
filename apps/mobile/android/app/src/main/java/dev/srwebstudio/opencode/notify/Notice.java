package dev.srwebstudio.opencode.notify;

/** One notification the engine decided to show. Only wording: never tool input, file content or transcript. */
public final class Notice {
  public final ServerRef server;
  public final String sessionID;
  public final Kind kind;
  public final String title;
  public final String body;
  /** The permission or form id (attention only); null for turn ends. */
  public final String requestID;

  public Notice(ServerRef server, String sessionID, Kind kind, String title, String body, String requestID) {
    this.server = server;
    this.sessionID = sessionID;
    this.kind = kind;
    this.title = title;
    this.body = body;
    this.requestID = requestID;
  }

  /** The link a tap opens: handled by the app's deep-link routing. */
  public String deepLink() {
    return deepLink(server.serverId, sessionID);
  }

  public static String deepLink(String serverId, String sessionID) {
    return "opencode-mobile://session/" + enc(sessionID) + "?server=" + enc(serverId);
  }

  private static String enc(String s) {
    try {
      return java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20");
    } catch (java.io.UnsupportedEncodingException e) {
      throw new IllegalStateException(e);
    }
  }
}
