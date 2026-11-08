package dev.srwebstudio.opencode.notify;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Markdown to plain reading lines, for a notification. Not a renderer: it drops what would look like noise in a
 * notification (heading marks, bullets, bold, backticks, link targets) and skips what is not prose (fenced code,
 * rules, table separators).
 */
public final class Markdown {
  private Markdown() {}

  private static final Pattern RULE = Pattern.compile("^\\s*([-*_]\\s*){3,}$");
  private static final Pattern TABLE_SEP = Pattern.compile("^[\\s|:-]+$");
  private static final Pattern HEADING = Pattern.compile("^\\s{0,3}#{1,6}\\s+");
  private static final Pattern QUOTE = Pattern.compile("^\\s*(>\\s?)+");
  private static final Pattern BULLET = Pattern.compile("^\\s*[-*+]\\s+(\\[[ xX]\\]\\s+)?");
  private static final Pattern IMAGE = Pattern.compile("!\\[([^\\]]*)\\]\\([^)]*\\)");
  private static final Pattern LINK = Pattern.compile("\\[([^\\]]+)\\]\\([^)]*\\)");
  private static final Pattern REF_LINK = Pattern.compile("\\[([^\\]]+)\\]\\[[^\\]]*\\]");
  private static final Pattern AUTOLINK = Pattern.compile("<(https?://[^>\\s]+)>");
  private static final Pattern HTML_TAG = Pattern.compile("</?[a-zA-Z][^>]*>");
  private static final Pattern CODE = Pattern.compile("`+([^`]+)`+");
  private static final Pattern BOLD = Pattern.compile("\\*\\*(.+?)\\*\\*");
  private static final Pattern BOLD_US = Pattern.compile("(?<![\\w])__(.+?)__(?![\\w])");
  private static final Pattern STRIKE = Pattern.compile("~~(.+?)~~");
  private static final Pattern ITALIC = Pattern.compile("(?<![\\w*])\\*(?![\\s*])(.+?)(?<![\\s*])\\*(?![\\w*])");
  private static final Pattern ITALIC_US = Pattern.compile("(?<![\\w])_(?![\\s_])(.+?)(?<![\\s_])_(?![\\w])");
  private static final Pattern ESCAPED = Pattern.compile("\\\\([\\\\`*_{}\\[\\]()#+.!|>~-])");
  private static final Pattern SPACES = Pattern.compile("\\s+");

  /** The meaningful lines of {@code md}, in order, as plain text. Empty lines, fences and code blocks are gone. */
  public static List<String> lines(String md) {
    List<String> out = new ArrayList<>();
    if (md == null) return out;
    boolean fenced = false;
    for (String raw : md.split("\\r?\\n|\\r")) {
      String trimmed = raw.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        fenced = !fenced;
        continue;
      }
      if (fenced || trimmed.isEmpty()) continue;
      if (RULE.matcher(raw).matches()) continue;
      if (trimmed.indexOf('-') >= 0 && TABLE_SEP.matcher(trimmed).matches() && trimmed.indexOf('|') >= 0) continue;
      String s = QUOTE.matcher(raw).replaceFirst("");
      s = HEADING.matcher(s).replaceFirst("");
      s = BULLET.matcher(s).replaceFirst("");
      s = inline(s);
      if (hasWord(s)) out.add(s);
    }
    return out;
  }

  /** Inline marks removed from one line; whitespace collapsed. */
  public static String inline(String line) {
    String s = line;
    s = IMAGE.matcher(s).replaceAll("$1");
    s = LINK.matcher(s).replaceAll("$1");
    s = REF_LINK.matcher(s).replaceAll("$1");
    s = AUTOLINK.matcher(s).replaceAll("$1");
    s = HTML_TAG.matcher(s).replaceAll("");
    s = CODE.matcher(s).replaceAll("$1");
    s = BOLD.matcher(s).replaceAll("$1");
    s = BOLD_US.matcher(s).replaceAll("$1");
    s = STRIKE.matcher(s).replaceAll("$1");
    s = ITALIC.matcher(s).replaceAll("$1");
    s = ITALIC_US.matcher(s).replaceAll("$1");
    s = ESCAPED.matcher(s).replaceAll("$1");
    // A table row reads as a list of cells.
    String t = s.trim();
    if (t.startsWith("|") && t.endsWith("|") && t.length() > 1) {
      s = t.substring(1, t.length() - 1).replaceAll("\\s*\\|\\s*", " \u00b7 ");
    }
    return SPACES.matcher(s).replaceAll(" ").trim();
  }

  private static boolean hasWord(String s) {
    for (int i = 0; i < s.length(); i++) {
      if (Character.isLetterOrDigit(s.charAt(i))) return true;
    }
    return false;
  }
}
