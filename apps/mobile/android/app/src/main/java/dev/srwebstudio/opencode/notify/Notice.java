package dev.srwebstudio.opencode.notify;

/**
 * One notification the engine decided to show. Only wording: the session title, a line of the answer or question,
 * the folder. Never tool input or output, file content or reasoning.
 */
public final class Notice {
  public final ServerRef server;
  public final String sessionID;
  public final Kind kind;
  /** Status mark and session title. */
  public final String title;
  /** The collapsed one-line text, folder at the end. */
  public final String body;
  /** The expanded text (BigTextStyle), folder on the last line. */
  public final String expanded;
  /** Small header text next to the app name: "worker of X" and/or the profile name. Null for none. */
  public final String subText;
  /** The server profile's name when more than one is saved, else null. */
  public final String profileName;
  /** The permission or form id (attention only); null for turn ends. */
  public final String requestID;

  public Notice(ServerRef server, String sessionID, Kind kind, String title, String body, String expanded, String subText, String profileName, String requestID) {
    this.server = server;
    this.sessionID = sessionID;
    this.kind = kind;
    this.title = title;
    this.body = body;
    this.expanded = expanded == null || expanded.isEmpty() ? body : expanded;
    this.subText = subText == null || subText.isEmpty() ? null : subText;
    this.profileName = profileName == null || profileName.isEmpty() ? null : profileName;
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
