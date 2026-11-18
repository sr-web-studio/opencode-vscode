package dev.srwebstudio.opencode.notify;

/** The few facts about a session that wording and the turn-end rules need. Any field may be null. */
public final class SessionMeta {
  public final String title;
  public final String parentID;
  public final String directory;
  /**
   * {@code time.viewed} from the server: set once any client has opened the session after a turn ended. Null means
   * no client ever did (an agent's own probe session, for instance).
   */
  public final Long viewed;

  public SessionMeta(String title, String parentID, String directory) {
    this(title, parentID, directory, null);
  }

  public SessionMeta(String title, String parentID, String directory, Long viewed) {
    this.title = title;
    this.parentID = parentID == null || parentID.isEmpty() ? null : parentID;
    this.directory = directory;
    this.viewed = viewed;
  }

  /** The same session once a client has viewed it (never moves backwards). */
  public SessionMeta withViewed(long at) {
    if (viewed != null && viewed >= at) return this;
    return new SessionMeta(title, parentID, directory, at);
  }
}
