package dev.srwebstudio.opencode.notify;

/** The words of a notification. Never tool input, file content or transcript: only the title, folder and one short line. */
public final class Wording {
  private Wording() {}

  private static final String SEP = " \u00b7 ";

  /**
   * @param meta the session (may be null: the title then reads "OpenCode")
   * @param parent the parent session of a worker (may be null)
   * @param detail permission action, question text or first error line (may be null)
   * @param directory the project folder (may be null)
   */
  public static Notice build(ServerRef server, String sessionID, Kind kind, SessionMeta meta, SessionMeta parent, String detail, String directory, boolean failed) {
    String label = Text.label(meta == null ? null : meta.title);
    boolean worker = meta != null && meta.parentID != null;
    String folder = Text.folderName(directory);
    String suffix = worker ? " (worker of " + Text.label(parent == null ? null : parent.title) + ")" : "";
    String title;
    String text;
    switch (kind) {
      case PERMISSION:
        title = label + " needs permission" + suffix;
        text = detail == null || detail.isEmpty() ? "Permission" : detail;
        break;
      case QUESTION:
        title = label + " has a question" + suffix;
        text = Text.safe(detail, Text.DETAIL_MAX);
        if (text.isEmpty()) text = "Needs your input";
        break;
      case FAILED:
        title = label + " failed";
        text = failureLine(detail);
        break;
      case WORKER:
        title = label + (failed ? " failed" : " finished") + suffix;
        text = failed ? failureLine(detail) : "Turn finished";
        break;
      default:
        title = label + " finished";
        text = "Turn finished";
    }
    String body = folder.isEmpty() ? text : text + SEP + folder;
    return new Notice(server, sessionID, kind, title, body, null);
  }

  private static String failureLine(String detail) {
    String s = Text.safe(detail, Text.DETAIL_MAX);
    return s.isEmpty() ? "The turn failed" : s;
  }
}
