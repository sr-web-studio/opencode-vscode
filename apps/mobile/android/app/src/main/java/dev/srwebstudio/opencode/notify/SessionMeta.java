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
  /** {@code metadata.client}: who created the session (this app and the VS Code extension write {@value #CLIENT}). */
  public final String client;

  /** The value of {@code metadata.client} that the clients of this repository put on the sessions they create. */
  public static final String CLIENT = "occ";

  public SessionMeta(String title, String parentID, String directory) {
    this(title, parentID, directory, null, null);
  }

  public SessionMeta(String title, String parentID, String directory, Long viewed) {
    this(title, parentID, directory, viewed, null);
  }

  public SessionMeta(String title, String parentID, String directory, Long viewed, String client) {
    this.title = title;
    this.parentID = parentID == null || parentID.isEmpty() ? null : parentID;
    this.directory = directory;
    this.viewed = viewed;
    this.client = client;
  }

  /** A person started this session in one of our clients, so it counts as opened before any stamp exists. */
  public boolean createdHere() {
    return CLIENT.equals(client);
  }

  /** The same session once a client has viewed it (never moves backwards). */
  public SessionMeta withViewed(long at) {
    if (viewed != null && viewed >= at) return this;
    return new SessionMeta(title, parentID, directory, at, client);
  }
}
