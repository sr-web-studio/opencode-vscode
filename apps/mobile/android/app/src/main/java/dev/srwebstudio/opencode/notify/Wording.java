package dev.srwebstudio.opencode.notify;

/**
 * The words of a notification.
 *
 * <ul>
 *   <li>Title: a status mark and the session title only (no "finished" words: the mark carries it).
 *   <li>Body (collapsed): {@link Detail#line}, then the folder.
 *   <li>Expanded: {@link Detail#full}, then the folder on the last line.
 *   <li>Sub-text: "worker of &lt;parent&gt;" for a worker, and the profile name only when more than one server is saved.
 * </ul>
 */
public final class Wording {
  private Wording() {}

  private static final String SEP = " \u00b7 ";
  static final String MARK_FINISHED = "\u2705";
  static final String MARK_FAILED = "\u274c";
  static final String MARK_QUESTION = "\u2753";
  static final String MARK_PERMISSION = "\uD83D\uDD10";

  /**
   * @param meta the session (may be null: the title then reads "OpenCode")
   * @param parent the parent session of a worker (may be null)
   * @param detail the one line and the long text (may be null)
   * @param directory the project folder (may be null)
   * @param multiServer more than one server profile is saved: the profile name is shown
   * @param failed the turn failed (picks the mark of a worker notice)
   */
  public static Notice build(ServerRef server, String sessionID, Kind kind, SessionMeta meta, SessionMeta parent, Detail detail, String directory, boolean multiServer, boolean failed) {
    String label = Text.label(meta == null ? null : meta.title);
    boolean worker = meta != null && meta.parentID != null;
    String folder = Text.folderName(directory);
    String mark;
    switch (kind) {
      case PERMISSION:
        mark = MARK_PERMISSION;
        break;
      case QUESTION:
        mark = MARK_QUESTION;
        break;
      case FAILED:
        mark = MARK_FAILED;
        break;
      case WORKER:
        mark = failed ? MARK_FAILED : MARK_FINISHED;
        break;
      default:
        mark = MARK_FINISHED;
    }
    Detail d = detail != null ? detail : fallback(kind, failed);
    String body = folder.isEmpty() ? d.line : d.line + SEP + folder;
    String expanded = folder.isEmpty() ? d.full : d.full + "\n" + folder;
    String profile = multiServer ? Text.clip(Text.redact(Text.squash(server.name)), Text.TITLE_MAX) : null;
    String sub = null;
    if (worker) sub = "worker of " + Text.label(parent == null ? null : parent.title);
    if (profile != null && !profile.isEmpty()) sub = sub == null ? profile : sub + SEP + profile;
    return new Notice(server, sessionID, kind, mark + " " + label, body, expanded, sub, profile, null);
  }

  private static Detail fallback(Kind kind, boolean failed) {
    switch (kind) {
      case PERMISSION:
        return new Detail("Permission requested", null);
      case QUESTION:
        return new Detail("Needs your input", null);
      case FAILED:
        return new Detail("The turn failed", null);
      case WORKER:
        return failed ? new Detail("The turn failed", null) : new Detail("Finished", null);
      default:
        return new Detail("Finished", null);
    }
  }
}
