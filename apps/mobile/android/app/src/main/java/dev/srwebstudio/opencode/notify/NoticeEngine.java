package dev.srwebstudio.opencode.notify;

import java.util.HashMap;
import java.util.Map;
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
  /** Wait before the one retry of the answer lookup. Measured live: the text was there at the first fetch 5 of 5 times. */
  public static final long ANSWER_RETRY_MS = 700;
  private static final long META_TTL_MS = 20_000;
  private static final int SEEN_MAX = 300;

  public interface Deps {
    /** Title, parent and folder of a session. May return null or throw: wording then falls back. */
    SessionMeta session(ServerRef server, String sessionID) throws Exception;

    /**
     * The text of the agent's last answer in this session (text parts only), or null when there is none. Called after a
     * successful turn. May throw or time out (a few seconds): the notice then reads "Finished".
     */
    String lastAnswer(ServerRef server, String sessionID) throws Exception;

    /** Wait this long (the answer may not be stored yet). Returns early when interrupted. */
    void pause(long ms);

    /** How many server profiles are saved: the profile name is shown only when there is more than one. */
    int profileCount();

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
      case "permission.asked":
        attention(server, directoryOf(ev), d.optString("sessionID", ""), Kind.PERMISSION, d.optString("id", ""), Detail.permission(d));
        return;
      case "form.created": {
        JSONObject form = d.optJSONObject("form");
        if (form == null) return;
        attention(server, directoryOf(ev), form.optString("sessionID", ""), Kind.QUESTION, form.optString("id", ""), Detail.question(form));
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

  private static String key(ServerRef server, String sessionID) {
    return server.id + "|" + sessionID;
  }

  /** Where the pending requests of a server can be read (the catch-up after a gap). */
  public interface PendingSource {
    /** The folders worth asking about. */
    java.util.List<String> directories(ServerRef server) throws Exception;

    /** Pending forms of one folder: {@code [{id, sessionID, title, fields}]}. */
    org.json.JSONArray forms(ServerRef server, String directory) throws Exception;

    /** Pending permission requests of one folder: {@code [{id, sessionID, action, resources}]}. */
    org.json.JSONArray permissions(ServerRef server, String directory) throws Exception;
  }

  /** At most this many catch-up notices per run, so an old backlog cannot flood the shade. */
  public static final int CATCHUP_MAX = 8;

  /**
   * After a (re)connect: the questions and permission requests that are open right now, announced when they were not
   * announced before. A gap (the service was killed, the network was away) must not silently lose one. Same rules as a
   * live event: the seen set dedupes, the visible session is skipped, the switches apply. Never throws. Returns how many
   * notices went out.
   */
  public int catchUp(ServerRef server, PendingSource source) {
    int shownNow = 0;
    java.util.List<String> dirs;
    try {
      dirs = source.directories(server);
    } catch (Exception e) {
      log("catch-up: folder list failed: " + e.getClass().getSimpleName());
      return 0;
    }
    for (String dir : dirs) {
      if (shownNow >= CATCHUP_MAX) break;
      try {
        org.json.JSONArray forms = source.forms(server, dir);
        for (int i = 0; forms != null && i < forms.length() && shownNow < CATCHUP_MAX; i++) {
          JSONObject f = forms.optJSONObject(i);
          if (f != null && attention(server, dir, f.optString("sessionID", ""), Kind.QUESTION, f.optString("id", ""), Detail.question(f))) shownNow++;
        }
        org.json.JSONArray perms = source.permissions(server, dir);
        for (int i = 0; perms != null && i < perms.length() && shownNow < CATCHUP_MAX; i++) {
          JSONObject p = perms.optJSONObject(i);
          if (p != null && attention(server, dir, p.optString("sessionID", ""), Kind.PERMISSION, p.optString("id", ""), Detail.permission(p))) shownNow++;
        }
      } catch (Exception e) {
        log("catch-up: folder skipped: " + e.getClass().getSimpleName());
      }
    }
    if (shownNow > 0) log("catch-up: " + shownNow + " open request(s) announced");
    return shownNow;
  }

  /** True when a notice went out. */
  private boolean attention(ServerRef server, String fallbackDir, String sessionID, Kind kind, String requestID, Detail detail) throws Exception {
    if (sessionID.isEmpty()) return false;
    if (!deps.settings().allows(kind)) return false;
    // A worker's permission or question blocks its parent, so it is announced like any attention request, whatever the
    // worker switch says (the VS Code engine gates attention by the permission/question switches only). Tapping it
    // opens the worker read-only screen, where a permission is answered; a question's form is not shown there yet,
    // which matches the VS Code worker tab.
    if (!requestID.isEmpty() && !markSeen("req|" + server.id + "|" + requestID)) {
      log("skip " + kind + " (" + sessionID + "): request already announced");
      return false;
    }
    if (deps.isVisible(server, sessionID)) {
      log("skip " + kind + " (" + sessionID + "): session on screen");
      return false;
    }
    long t = deps.now();
    String k = key(server, sessionID);
    synchronized (this) {
      shown.put(k, new Shown(kind, requestID.isEmpty() ? null : requestID, t));
    }
    SessionMeta meta = lookup(server, sessionID);
    String dir = meta != null && meta.directory != null ? meta.directory : fallbackDir;
    deps.show(Wording.build(server, sessionID, kind, meta, parent(server, meta), detail, dir, multiServer(), false));
    return true;
  }

  private boolean multiServer() {
    try {
      return deps.profileCount() > 1;
    } catch (RuntimeException e) {
      return false;
    }
  }

  private void turnEnd(ServerRef server, JSONObject ev, JSONObject d, boolean failed) throws Exception {
    String sessionID = d.optString("sessionID", "");
    if (sessionID.isEmpty()) return;
    String evID = ev.optString("id", "");
    // The same event twice (a reconnect that replays): the first one stands.
    if (!evID.isEmpty() && !markSeen("evt|" + server.id + "|" + evID)) return;
    SessionMeta meta = lookup(server, sessionID);
    if (meta == null) {
      // The event carries only the session id. Without the session's facts a worker would be announced as a root
      // "finished"; stay quiet until a later event (or the cache) can tell what it is.
      log("skip turn end (" + sessionID + "): session lookup failed, cannot tell a worker from a root");
      return;
    }
    boolean worker = meta.parentID != null;
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
    Detail detail = failed ? Detail.error(errorMessage(d)) : answer(server, sessionID);
    String dir = meta != null && meta.directory != null ? meta.directory : directoryOf(ev);
    deps.show(Wording.build(server, sessionID, kind, meta, parent(server, meta), detail, dir, multiServer(), failed));
  }

  private static String errorMessage(JSONObject d) {
    JSONObject err = d.optJSONObject("error");
    return err == null ? "" : err.optString("message", "");
  }

  /**
   * The last answer of this turn as notification text. {@code lastAnswer} only returns text that sits after the
   * message that started the turn, so an empty result means "not stored yet" or "no text": one retry after
   * {@link #ANSWER_RETRY_MS}. A failed lookup (timeout, HTTP error) is not retried. Either way the notice goes out,
   * reading "Finished" when there is no text.
   */
  private Detail answer(ServerRef server, String sessionID) {
    try {
      String text = deps.lastAnswer(server, sessionID);
      if (text == null || text.trim().isEmpty()) {
        deps.pause(ANSWER_RETRY_MS);
        text = deps.lastAnswer(server, sessionID);
      }
      return Detail.answer(text);
    } catch (Exception e) {
      log("last answer lookup failed (" + sessionID + "): " + e.getClass().getSimpleName());
      return Detail.answer(null);
    }
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
