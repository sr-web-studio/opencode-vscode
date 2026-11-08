package dev.srwebstudio.opencode.notify;

import org.json.JSONException;
import org.json.JSONObject;

/** One saved server profile as the app hands it over: where to connect and how to name it. */
public final class ServerRef {
  /** The profile id in the app. */
  public final String id;
  public final String name;
  /** Base address, no trailing slash. */
  public final String url;
  /** The server password or pairing token. Never logged, never shown. */
  public final String password;
  /** What the notification deep link calls this server ({@code ?server=}). */
  public final String serverId;

  public ServerRef(String id, String name, String url, String password, String serverId) {
    this.id = id;
    this.url = url.replaceAll("/+$", "");
    this.name = name == null || name.isEmpty() ? this.url : name;
    this.password = password == null ? "" : password;
    this.serverId = serverId == null || serverId.isEmpty() ? id : serverId;
  }

  /** Null when the object lacks an id or an address. */
  public static ServerRef fromJson(JSONObject o) {
    String id = o.optString("id", "");
    String url = o.optString("url", "");
    if (id.isEmpty() || url.isEmpty()) return null;
    return new ServerRef(id, o.optString("name", ""), url, o.optString("password", ""), o.optString("serverId", ""));
  }

  public JSONObject toJson() throws JSONException {
    return new JSONObject().put("id", id).put("name", name).put("url", url).put("password", password).put("serverId", serverId);
  }

  public boolean sameConnection(ServerRef o) {
    return o != null && id.equals(o.id) && url.equals(o.url) && password.equals(o.password) && name.equals(o.name) && serverId.equals(o.serverId);
  }

  @Override
  public String toString() {
    // No password, ever.
    return "ServerRef(" + id + " " + url + ")";
  }
}
