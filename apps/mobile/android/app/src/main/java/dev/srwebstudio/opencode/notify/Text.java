package dev.srwebstudio.opencode.notify;

import java.util.regex.Pattern;

/** Text helpers for what ends up on a lock screen. Same rules as plugins/opencode-push/src/format.ts. */
public final class Text {
  private Text() {}

  private static final Pattern BEARER = Pattern.compile("\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]{8,}", Pattern.CASE_INSENSITIVE);
  private static final Pattern PREFIXED = Pattern.compile("\\b(sk|pk|tk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}");
  private static final Pattern ASSIGNED =
      Pattern.compile("\\b(api[_-]?key|token|secret|password|passwd)([\"']?\\s*[:=]\\s*[\"']?)[^\\s\"',;]{4,}", Pattern.CASE_INSENSITIVE);
  private static final Pattern LONG_BLOB = Pattern.compile("\\b[A-Za-z0-9+/_-]{40,}={0,2}");

  public static final int TITLE_MAX = 80;
  public static final int DETAIL_MAX = 140;

  /** Cut to {@code max} characters with an ellipsis. Never splits a surrogate pair. */
  public static String clip(String text, int max) {
    if (text == null) return "";
    if (text.length() <= max) return text;
    int end = Math.max(0, max - 1);
    if (end > 0 && Character.isHighSurrogate(text.charAt(end - 1))) end--;
    return text.substring(0, end).replaceAll("\\s+$", "") + "\u2026";
  }

  public static String firstLine(String text) {
    if (text == null) return "";
    for (String l : text.split("\\r?\\n")) {
      if (!l.trim().isEmpty()) return l.trim();
    }
    return "";
  }

  /** Blank out anything that looks like a credential. */
  public static String redact(String text) {
    if (text == null) return "";
    String t = BEARER.matcher(text).replaceAll("$1 [redacted]");
    t = PREFIXED.matcher(t).replaceAll("[redacted]");
    t = ASSIGNED.matcher(t).replaceAll("$1$2[redacted]");
    return LONG_BLOB.matcher(t).replaceAll("[redacted]");
  }

  /** First line, credentials blanked, clipped. */
  public static String safe(String text, int max) {
    return clip(redact(firstLine(text)), max);
  }

  /** The last path segment, for both / and \ paths. Empty when there is none. */
  public static String folderName(String directory) {
    if (directory == null) return "";
    String t = directory.replace('\\', '/').replaceAll("/+$", "");
    int i = t.lastIndexOf('/');
    return i < 0 ? t : t.substring(i + 1);
  }

  /** The session title as the notification shows it; OpenCode when there is none. */
  public static String label(String title) {
    String t = clip(redact(firstLine(title)), TITLE_MAX);
    return t.isEmpty() ? "OpenCode" : t;
  }
}
