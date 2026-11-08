package dev.srwebstudio.opencode.notify;

import java.io.IOException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The open questions and permission requests of a server, for the catch-up after a gap. The server answers per folder
 * ({@code GET /api/form?location[directory]=...}, {@code GET /api/permission/request?location[directory]=...}), so the
 * folders come from {@code GET /api/project}: the most recently active ones only (a request that is open now belongs
 * to a session that ran lately), at most {@link #MAX_FOLDERS}.
 */
public final class PendingApi implements NoticeEngine.PendingSource {
  /** Only projects active within this window are asked (a pending request cannot belong to a long-dead project). */
  static final long WINDOW_MS = 7L * 24 * 3600 * 1000;

  static final int MAX_FOLDERS = 12;
  private static final int CONNECT_MS = 4_000;
  private static final int READ_MS = 6_000;
  private static final int MAX_BYTES = 2_000_000;

  private final SessionApi.Fetch fetch;
  private final java.util.function.LongSupplier clock;

  public PendingApi() {
    this(SessionApi.HTTP, System::currentTimeMillis);
  }

  PendingApi(SessionApi.Fetch fetch, java.util.function.LongSupplier clock) {
    this.fetch = fetch;
    this.clock = clock;
  }

  @Override
  public List<String> directories(ServerRef server) throws IOException, JSONException {
    return folders(fetch.get(server, "/api/project", CONNECT_MS, READ_MS, MAX_BYTES), clock.getAsLong());
  }

  @Override
  public JSONArray forms(ServerRef server, String directory) throws IOException, JSONException {
    return data(fetch.get(server, "/api/form?" + location(directory), CONNECT_MS, READ_MS, MAX_BYTES));
  }

  @Override
  public JSONArray permissions(ServerRef server, String directory) throws IOException, JSONException {
    return data(fetch.get(server, "/api/permission/request?" + location(directory), CONNECT_MS, READ_MS, MAX_BYTES));
  }

  static String location(String directory) throws java.io.UnsupportedEncodingException {
    return "location%5Bdirectory%5D=" + URLEncoder.encode(directory, "UTF-8");
  }

  /** The project list ({@code [{canonical, sandboxes, time:{active}}]}) as folders, newest activity first, capped. */
  static List<String> folders(String json, long now) throws JSONException {
    JSONArray arr = new JSONArray(json);
    final List<Object[]> found = new ArrayList<>();
    for (int i = 0; i < arr.length(); i++) {
      JSONObject p = arr.optJSONObject(i);
      if (p == null) continue;
      JSONObject time = p.optJSONObject("time");
      long active = time == null ? 0 : time.optLong("active", time.optLong("updated", 0));
      if (active > 0 && now - active > WINDOW_MS) continue;
      String canonical = p.optString("canonical", "");
      if (!canonical.isEmpty()) found.add(new Object[] {canonical, active});
      JSONArray boxes = p.optJSONArray("sandboxes");
      for (int j = 0; boxes != null && j < boxes.length(); j++) {
        String box = boxes.optString(j, "");
        if (!box.isEmpty() && box.startsWith("/")) found.add(new Object[] {box, active});
      }
    }
    Collections.sort(
        found,
        new Comparator<Object[]>() {
          @Override
          public int compare(Object[] a, Object[] b) {
            return Long.compare((Long) b[1], (Long) a[1]);
          }
        });
    List<String> out = new ArrayList<>();
    for (Object[] f : found) {
      String dir = (String) f[0];
      if (!out.contains(dir)) out.add(dir);
      if (out.size() >= MAX_FOLDERS) break;
    }
    return out;
  }

  /** {@code {"data": [...]}} (a location envelope). */
  static JSONArray data(String json) throws JSONException {
    JSONArray a = new JSONObject(json).optJSONArray("data");
    return a == null ? new JSONArray() : a;
  }
}
