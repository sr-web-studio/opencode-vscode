package dev.srwebstudio.opencode.notify;

import org.json.JSONException;
import org.json.JSONObject;

/** The owner's notification switches. Everything is on by default. Not secret. */
public final class Settings {
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
    return new Settings(true, true, true, true, true, true);
  }

  public static Settings fromJson(JSONObject o) {
    if (o == null) return defaults();
    return new Settings(
        o.optBoolean("enabled", true),
        o.optBoolean("permission", true),
        o.optBoolean("question", true),
        o.optBoolean("finished", true),
        o.optBoolean("failed", true),
        o.optBoolean("workers", true));
  }

  public JSONObject toJson() throws JSONException {
    return new JSONObject()
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
