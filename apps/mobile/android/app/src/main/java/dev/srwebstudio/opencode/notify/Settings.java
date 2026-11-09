package dev.srwebstudio.opencode.notify;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The owner's notification switches. Everything is on by default except {@link #workers}: a worker (child session)
 * ending its turn is background noise on a phone, so it is opt-in. Not secret.
 *
 * <p>{@link #VERSION} 2 introduced that default. A saved file from before it (no {@code version}) kept the old default
 * {@code workers: true}; {@link #load(String)} reads such a file with the worker switch off once, because the saved
 * {@code true} cannot be told apart from a deliberate choice. The next save writes the version.
 */
public final class Settings {
  /** Shape version of the saved switches. Bump it whenever a saved default must be re-read. */
  public static final int VERSION = 2;

  public final boolean enabled;
  public final boolean permission;
  public final boolean question;
  public final boolean finished;
  public final boolean failed;
  public final boolean workers;

  public Settings(boolean enabled, boolean permission, boolean question, boolean finished, boolean failed, boolean workers) {
    this.enabled = enabled;
    this.permission = permission;
    this.question = question;
    this.finished = finished;
    this.failed = failed;
    this.workers = workers;
  }

  public static Settings defaults() {
    return new Settings(true, true, true, true, true, false);
  }

  /**
   * The switches of the JSON the WebView hands over. Every field is read as sent (the app always sends all of them);
   * a missing {@code workers} is off.
   */
  public static Settings fromJson(JSONObject o) {
    if (o == null) return defaults();
    return fromJson(o, false);
  }

  /**
   * @param legacyWorkersOff a saved file from before {@link #VERSION}: its {@code workers: true} was the old default.
   */
  static Settings fromJson(JSONObject o, boolean legacyWorkersOff) {
    if (o == null) return defaults();
    boolean workers = o.optBoolean("workers", false) && !legacyWorkersOff;
    return new Settings(
        o.optBoolean("enabled", true),
        o.optBoolean("permission", true),
        o.optBoolean("question", true),
        o.optBoolean("finished", true),
        o.optBoolean("failed", true),
        workers);
  }

  /** Read the saved JSON; missing, old or broken files get the defaults (the old file keeps its other switches). */
  public static Settings load(String raw) {
    if (raw == null || raw.isEmpty()) return defaults();
    try {
      JSONObject o = new JSONObject(raw);
      return fromJson(o, !o.has("version"));
    } catch (JSONException e) {
      return defaults();
    }
  }

  public JSONObject toJson() throws JSONException {
    return new JSONObject()
        .put("version", VERSION)
        .put("enabled", enabled)
        .put("permission", permission)
        .put("question", question)
        .put("finished", finished)
        .put("failed", failed)
        .put("workers", workers);
  }

  /** Is this kind switched on (and notifications as a whole)? */
  public boolean allows(Kind kind) {
    if (!enabled) return false;
    switch (kind) {
      case PERMISSION:
        return permission;
      case QUESTION:
        return question;
      case FINISHED:
        return finished;
      case FAILED:
        return failed;
      default:
        return workers;
    }
  }
}
