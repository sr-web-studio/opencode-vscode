package dev.srwebstudio.opencode.notify;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Decides which server events become notifications and what they say. Same rules as the VS Code extension's
 * notification engine and the push plugin: permission, question, finished, failed, worker turn ends; one notification
 * per session per 5 s window where attention beats turn ends; the same request is announced once; an answered
 * permission or form cancels its notification. Pure Java: everything Android sits behind {@link Deps}.
 *
 * {@link #handle} is called from one thread per server. It blocks on the session lookup (an HTTP call), never throws.
 */
public final class NoticeEngine {
  public static final long COALESCE_MS = 5_000;
  private static final long META_TTL_MS = 20_000;
  private static final int SEEN_MAX = 300;
  private static final Pattern ACTION = Pattern.compile("^[\\w.:-]{1,40}$");

  public interface Deps {
    /** Title, parent and folder of a session. May return null or throw: wording then falls back. */
    SessionMeta session(ServerRef server, String sessionID) throws Exception;

    void show(Notice notice);

    /** Remove the notification of this session (if any). */
    void cancel(ServerRef server, String sessionID);

    Settings settings();

    /** The app is in the foreground showing exactly this session. */
    boolean isVisible(ServerRef server, String sessionID);

    /** The seen set changed: keep it on disk. */
    void seenChanged(String serialized);

    long now();

    void log(String line);
  }

  private static final class Shown {
    final Kind kind;
    final String requestID;
    final long at;

    Shown(Kind kind, String requestID, long at) {
      this.kind = kind;
      this.requestID = requestID;
      this.at = at;
    }
  }

  private static final class Cached {
    final SessionMeta meta;
    final long at;

    Cached(SessionMeta meta, long at) {
      this.meta = meta;
      this.at = at;
    }
  }

  private final Deps deps;
  private final SeenSet seen = new SeenSet(SEEN_MAX);
  private final Map<String, Shown> shown = new HashMap<>();
  private final Map<String, Cached> metas = new HashMap<>();

  public NoticeEngine(Deps deps, String seenState) {
    this.deps = deps;
    this.seen.load(seenState);
  }

  public SeenSet seen() {
    return seen;
  }

  /** Feed one event envelope ({@code {id, type, data, location?}}). */
  public void handle(ServerRef server, JSONObject ev) {
    try {
      dispatch(server, ev);
    } catch (Exception e) {
      log("event " + ev.optString("type", "?") + " skipped: " + e.getClass().getSimpleName());
    }
  }

  private void dispatch(ServerRef server, JSONObject ev) throws Exception {
    String type = ev.optString("type", "");
    JSONObject d = ev.optJSONObject("data");
    if (d == null) d = new JSONObject();
    switch (type) {
      case "permission.asked": {
        String action = d.optString("action", "");
        attention(server, ev, d.optString("sessionID", ""), Kind.PERMISSION, d.optString("id", ""), ACTION.matcher(action).matches() ? action : "Permission");
        return;
      }
      case "form.created": {
        JSONObject form = d.optJSONObject("form");
        if (form == null) return;
        attention(server, ev, form.optString("sessionID", ""), Kind.QUESTION, form.optString("id", ""), questionText(form));
        return;
      }
      case "session.execution.succeeded":
      case "session.execution.failed":
        turnEnd(server, ev, d, type.endsWith("failed"));
        return;
      case "permission.replied":
        clear(server, d.optString("sessionID", ""), d.optString("requestID", ""));
        return;
      case "form.replied":
      case "form.cancelled":
        clear(server, d.optString("sessionID", ""), d.optString("id", ""));
        return;
      case "session.deleted":
        clear(server, d.optString("sessionID", ""), null);
        return;
      default:
    }
  }

  /** The question as the extension words it: the first field's description (the question itself), else its title. */
  static String questionText(JSONObject form) {
    JSONArray fields = form.optJSONArray("fields");
    JSONObject f = fields != null && fields.length() > 0 ? fields.optJSONObject(0) : null;
    String text = "";
    if (f != null) {
      text = f.optString("description", "");
      if (text.trim().isEmpty()) text = f.optString("title", "");
    }
    if (text.trim().isEmpty()) text = form.optString("title", "");
    return text.trim().isEmpty() ? "Needs your input" : text;
  }

  private static String key(ServerRef server, String sessionID) {
    return server.id + "|" + sessionID;
  }

  private void attention(ServerRef server, JSONObject ev, String sessionID, Kind kind, String requestID, String detail) throws Exception {
    if (sessionID.isEmpty()) return;
    if (!deps.settings().allows(kind)) return;
    if (!requestID.isEmpty() && !markSeen("req|" + server.id + "|" + requestID)) {
      log("skip " + kind + " (" + sessionID + "): request already announced");
      return;
    }
    if (deps.isVisible(server, sessionID)) {
      log("skip " + kind + " (" + sessionID + "): session on screen");
      return;
    }
    long t = deps.now();
    String k = key(server, sessionID);
    synchronized (this) {
      shown.put(k, new Shown(kind, requestID.isEmpty() ? null : requestID, t));
    }
    SessionMeta meta = lookup(server, sessionID);
    String dir = meta != null && meta.directory != null ? meta.directory : directoryOf(ev);
    deps.show(Wording.build(server, sessionID, kind, meta, parent(server, meta), detail, dir, false));
  }

  private void turnEnd(ServerRef server, JSONObject ev, JSONObject d, boolean failed) throws Exception {
    String sessionID = d.optString("sessionID", "");
    if (sessionID.isEmpty()) return;
    String evID = ev.optString("id", "");
    // The same event twice (a reconnect that replays): the first one stands.
    if (!evID.isEmpty() && !markSeen("evt|" + server.id + "|" + evID)) return;
    SessionMeta meta = lookup(server, sessionID);
    boolean worker = meta != null && meta.parentID != null;
    Kind kind = worker ? Kind.WORKER : failed ? Kind.FAILED : Kind.FINISHED;
    if (!deps.settings().allows(kind)) {
      log("skip " + kind + " (" + sessionID + "): switched off");
      return;
    }
    if (deps.isVisible(server, sessionID)) {
      log("skip " + kind + " (" + sessionID + "): session on screen");
      return;
    }
    long t = deps.now();
    String k = key(server, sessionID);
    synchronized (this) {
      Shown prior = shown.get(k);
      if (prior != null && t - prior.at < COALESCE_MS) {
        log("skip " + kind + " (" + sessionID + "): a " + prior.kind + " notice went out " + (t - prior.at) + " ms ago");
        return;
      }
      // The same session finishing the same turn twice with different event ids is caught here as well.
      shown.put(k, new Shown(kind, null, t));
    }
    String detail = failed ? errorLine(d) : null;
    String dir = meta != null && meta.directory != null ? meta.directory : directoryOf(ev);
    deps.show(Wording.build(server, sessionID, kind, meta, parent(server, meta), detail, dir, failed));
  }

  private static String errorLine(JSONObject d) {
    JSONObject err = d.optJSONObject("error");
    String m = err == null ? "" : err.optString("message", "");
    return m.trim().isEmpty() ? "The turn failed" : m;
  }

  private static String directoryOf(JSONObject ev) {
    JSONObject loc = ev.optJSONObject("location");
    return loc == null ? null : loc.optString("directory", null);
  }

  private void clear(ServerRef server, String sessionID, String requestID) {
    if (sessionID.isEmpty()) return;
    String k = key(server, sessionID);
    synchronized (this) {
      Shown s = shown.get(k);
      if (requestID != null && (s == null || s.requestID == null || !s.requestID.equals(requestID))) return;
      shown.remove(k);
      if (requestID == null) metas.remove(k);
    }
    deps.cancel(server, sessionID);
  }

  /** The app opened the session or the owner dismissed it: forget what is showing. */
  public void forget(ServerRef server, String sessionID) {
    synchronized (this) {
      shown.remove(key(server, sessionID));
    }
  }

  private boolean markSeen(String k) {
    boolean fresh = seen.add(k);
    if (fresh) deps.seenChanged(seen.serialize());
    return fresh;
  }

  private SessionMeta lookup(ServerRef server, String sessionID) {
    String k = key(server, sessionID);
    long t = deps.now();
    Cached c;
    synchronized (this) {
      c = metas.get(k);
    }
    if (c != null && t - c.at < META_TTL_MS) return c.meta;
    try {
      SessionMeta m = deps.session(server, sessionID);
      if (m != null) {
        synchronized (this) {
          metas.put(k, new Cached(m, t));
          if (metas.size() > 200) metas.clear();
        }
        return m;
      }
    } catch (Exception e) {
      log("session lookup failed (" + sessionID + "): " + e.getClass().getSimpleName());
    }
    return c == null ? null : c.meta;
  }

  /** The parent's meta of a worker, or null. */
  private SessionMeta parent(ServerRef server, SessionMeta meta) {
    if (meta == null || meta.parentID == null) return null;
    return lookup(server, meta.parentID);
  }

  private void log(String line) {
    try {
      deps.log(line);
    } catch (RuntimeException ignored) {
      // logging never matters more than the notification
    }
  }
}
