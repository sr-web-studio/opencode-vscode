package dev.srwebstudio.opencode.notify;

/** What a notification is about. The order is the importance order. */
public enum Kind {
  /** A tool asked for permission. */
  PERMISSION(true),
  /** The agent created a form (a question). */
  QUESTION(true),
  /** A root session's turn succeeded. */
  FINISHED(false),
  /** A root session's turn failed. */
  FAILED(false),
  /** A worker (child session) turn ended, either way. */
  WORKER(false);

  /** Needs the owner's input: beats turn ends, never coalesced away, loud channel. */
  public final boolean attention;

  Kind(boolean attention) {
    this.attention = attention;
  }
}
