package dev.srwebstudio.opencode.notify;

/** Reconnect delays: 1 s, 2 s, 4 s, 8 s, 16 s, then 30 s for ever. */
public final class Backoff {
  private Backoff() {}

  public static final long MIN_MS = 1_000;
  public static final long MAX_MS = 30_000;

  /** The wait before reconnect number {@code attempt} (0 is the first retry). */
  public static long delayMs(int attempt) {
    if (attempt < 0) attempt = 0;
    if (attempt >= 5) return MAX_MS;
    return Math.min(MAX_MS, MIN_MS << attempt);
  }
}
