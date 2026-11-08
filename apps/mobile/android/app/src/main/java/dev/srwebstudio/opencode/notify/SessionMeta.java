package dev.srwebstudio.opencode.notify;

/** The few facts about a session that wording needs. Any field may be null. */
public final class SessionMeta {
  public final String title;
  public final String parentID;
  public final String directory;

  public SessionMeta(String title, String parentID, String directory) {
    this.title = title;
    this.parentID = parentID == null || parentID.isEmpty() ? null : parentID;
    this.directory = directory;
  }
}
