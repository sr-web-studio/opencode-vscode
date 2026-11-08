package dev.srwebstudio.opencode.notify;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reads from the server's HTTP API: {@code GET /api/session/{id}} (title, parent, folder: {@code session.execution.*}
 * events carry no location) and {@code GET /api/session/{id}/message} (the agent's last answer, for the turn-end text).
 */
public final class SessionApi {
  private SessionApi() {}

  /** One authenticated GET. Swapped in tests. */
  public interface Fetch {
    String get(ServerRef server, String path, int connectTimeoutMs, int readTimeoutMs, int maxBytes) throws IOException;
  }

  /** The real thing: {@link HttpURLConnection} with basic auth. */
  public static final Fetch HTTP =
      new Fetch() {
        @Override
        public String get(ServerRef server, String path, int connectTimeoutMs, int readTimeoutMs, int maxBytes) throws IOException {
          URL url = new URL(server.url + path);
          HttpURLConnection http = (HttpURLConnection) url.openConnection();
          try {
            http.setConnectTimeout(connectTimeoutMs);
            http.setReadTimeout(readTimeoutMs);
            http.setRequestProperty("Accept", "application/json");
            String auth = Auth.basic(server.password);
            if (auth != null) http.setRequestProperty("Authorization", auth);
            int status = http.getResponseCode();
            if (status != 200) throw new IOException("HTTP " + status);
            return read(http.getInputStream(), maxBytes);
          } finally {
            http.disconnect();
          }
        }
      };

  /** Time budget of the last-answer lookup: connecting plus reading is at most 5 s. */
  static final int ANSWER_CONNECT_MS = 2_000;
  static final int ANSWER_READ_MS = 3_000;
  /** Newest messages asked for: enough to get past tool-only messages back to the answer's text. */
  static final int ANSWER_PAGE = 6;
  private static final int ANSWER_MAX_BYTES = 3_000_000;

  public static SessionMeta get(ServerRef server, String sessionID) throws IOException, JSONException {
    return get(HTTP, server, sessionID);
  }

  public static SessionMeta get(Fetch fetch, ServerRef server, String sessionID) throws IOException, JSONException {
    return parse(fetch.get(server, "/api/session/" + URLEncoder.encode(sessionID, "UTF-8"), 8_000, 8_000, 1_000_000));
  }

  /** {@code {"data": {title, parentID, location: {directory}}}}. */
  public static SessionMeta parse(String json) throws JSONException {
    JSONObject root = new JSONObject(json);
    JSONObject d = root.optJSONObject("data");
    if (d == null) d = root;
    JSONObject loc = d.optJSONObject("location");
    return new SessionMeta(d.optString("title", null), d.optString("parentID", null), loc == null ? null : loc.optString("directory", null));
  }

  /** The text of the agent's last answer in the latest turn, or null. Throws on a failed call (the caller falls back). */
  public static String lastAnswer(ServerRef server, String sessionID) throws IOException, JSONException {
    return lastAnswer(HTTP, server, sessionID);
  }

  public static String lastAnswer(Fetch fetch, ServerRef server, String sessionID) throws IOException, JSONException {
    String path = "/api/session/" + URLEncoder.encode(sessionID, "UTF-8") + "/message?order=desc&limit=" + ANSWER_PAGE;
    return answerText(fetch.get(server, path, ANSWER_CONNECT_MS, ANSWER_READ_MS, ANSWER_MAX_BYTES));
  }

  /**
   * What starts a turn: a prompt from the owner, a synthetic prompt, a skill, or a compaction. Anything an assistant
   * message sits behind belongs to an earlier turn. (Markers like {@code idle} or {@code model-switched} and shell
   * output are skipped, they do not start a turn.)
   */
  private static boolean startsTurn(String type) {
    return "user".equals(type) || "synthetic".equals(type) || "skill".equals(type) || "compaction".equals(type);
  }

  /**
   * From a newest-first message page: the text parts of the newest assistant message that has any, never going past
   * the message that started the turn (so a previous turn's answer is never returned for this one). Tool, reasoning and
   * every other part is ignored. Null when there is none yet.
   */
  public static String answerText(String json) throws JSONException {
    JSONObject root = new JSONObject(json);
    JSONArray data = root.optJSONArray("data");
    if (data == null) return null;
    for (int i = 0; i < data.length(); i++) {
      JSONObject m = data.optJSONObject(i);
      if (m == null) continue;
      String type = m.optString("type", "");
      if (startsTurn(type)) return null;
      if (!"assistant".equals(type)) continue;
      String text = textOf(m);
      if (!text.isEmpty()) return text;
    }
    return null;
  }

  private static String textOf(JSONObject message) {
    JSONArray content = message.optJSONArray("content");
    if (content == null) return "";
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < content.length(); i++) {
      JSONObject p = content.optJSONObject(i);
      if (p == null || !"text".equals(p.optString("type", ""))) continue;
      String t = p.optString("text", "");
      if (t.trim().isEmpty()) continue;
      if (sb.length() > 0) sb.append("\n\n");
      sb.append(t);
      if (sb.length() > 20_000) break;
    }
    return sb.toString();
  }

  private static String read(InputStream in, int maxBytes) throws IOException {
    try (InputStream is = in) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[4096];
      int n;
      while ((n = is.read(buf)) >= 0) {
        out.write(buf, 0, n);
        if (out.size() > maxBytes) throw new IOException("response too large");
      }
      return out.toString(StandardCharsets.UTF_8.name());
    }
  }
}
