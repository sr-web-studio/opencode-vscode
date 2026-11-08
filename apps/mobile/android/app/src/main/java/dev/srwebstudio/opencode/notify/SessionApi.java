package dev.srwebstudio.opencode.notify;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

/** {@code GET /api/session/{id}}: the title, parent and folder of a session. {@code session.execution.*} events carry no location. */
public final class SessionApi {
  private SessionApi() {}

  public static SessionMeta get(ServerRef server, String sessionID) throws IOException, JSONException {
    URL url = new URL(server.url + "/api/session/" + URLEncoder.encode(sessionID, "UTF-8"));
    HttpURLConnection http = (HttpURLConnection) url.openConnection();
    try {
      http.setConnectTimeout(8_000);
      http.setReadTimeout(8_000);
      http.setRequestProperty("Accept", "application/json");
      String auth = Auth.basic(server.password);
      if (auth != null) http.setRequestProperty("Authorization", auth);
      int status = http.getResponseCode();
      if (status != 200) throw new IOException("HTTP " + status);
      return parse(read(http.getInputStream()));
    } finally {
      http.disconnect();
    }
  }

  /** {@code {"data": {title, parentID, location: {directory}}}}. */
  public static SessionMeta parse(String json) throws JSONException {
    JSONObject root = new JSONObject(json);
    JSONObject d = root.optJSONObject("data");
    if (d == null) d = root;
    JSONObject loc = d.optJSONObject("location");
    return new SessionMeta(d.optString("title", null), d.optString("parentID", null), loc == null ? null : loc.optString("directory", null));
  }

  private static String read(InputStream in) throws IOException {
    try (InputStream is = in) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[4096];
      int n;
      while ((n = is.read(buf)) >= 0) {
        out.write(buf, 0, n);
        if (out.size() > 1_000_000) throw new IOException("response too large");
      }
      return out.toString(StandardCharsets.UTF_8.name());
    }
  }
}
