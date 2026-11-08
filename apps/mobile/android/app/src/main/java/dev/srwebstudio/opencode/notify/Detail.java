package dev.srwebstudio.opencode.notify;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What a notification says besides the session title: one collapsed line and a longer text for the expanded view.
 * Built from the agent's last answer, an error message, a question form or a permission request. Everything passes
 * through {@link Text#redact} and is clipped. Only the answer's text parts, the form's own words and the permission's
 * own resource lines go in: never tool output, file content or reasoning.
 */
public final class Detail {
  public static final int LINE_MAX = 120;
  public static final int FULL_MAX = 600;
  static final int FULL_LINES = 6;
  private static final int SHORT_TITLE = 40;
  private static final int MAX_FIELDS = 5;
  private static final int MAX_OPTIONS = 8;
  private static final int MAX_RESOURCES = 8;
  private static final String DASH = " \u2014 ";
  private static final String DOT = " \u00b7 ";
  private static final Pattern ACTION = Pattern.compile("^[\\w.:-]{1,40}$");

  /** The collapsed one-line text. Never empty. */
  public final String line;
  /** The expanded text, without the folder line. Never empty. */
  public final String full;

  public Detail(String line, String full) {
    this.line = line;
    this.full = full == null || full.isEmpty() ? line : full;
  }

  /**
   * The collapsed line is the answer's {@link Markdown#summary} (first line that is not a heading or a bare lead-in);
   * the expanded text is its first few lines as they come, headings included. "Finished" when there is no text.
   */
  public static Detail answer(String markdown) {
    List<String> lines = Markdown.lines(markdown);
    if (lines.isEmpty()) return new Detail("Finished", null);
    return new Detail(Text.clip(Text.redact(Markdown.summary(markdown)), LINE_MAX), join(lines, FULL_LINES));
  }

  /** An error message: its first line, and a few lines of it. */
  public static Detail error(String message) {
    List<String> lines = plainLines(message);
    if (lines.isEmpty()) return new Detail("The turn failed", null);
    return new Detail(Text.clip(Text.redact(lines.get(0)), LINE_MAX), join(lines, FULL_LINES));
  }

  /** A question form ({@code {title, fields:[...]}}). */
  public static Detail question(JSONObject form) {
    List<JSONObject> fields = visibleFields(form);
    if (fields.isEmpty()) {
      String t = clean(form == null ? "" : form.optString("title", ""));
      String line = t.isEmpty() ? "Needs your input" : Text.clip(Text.redact(t), LINE_MAX);
      return new Detail(line, null);
    }
    String first = questionOf(fields.get(0));
    if (first.isEmpty()) first = clean(form.optString("title", ""));
    if (first.isEmpty()) first = "Needs your input";
    String more = fields.size() > 1 ? " (+" + (fields.size() - 1) + " more)" : "";
    String line = Text.clip(Text.redact(first), LINE_MAX - more.length()) + more;

    StringBuilder sb = new StringBuilder();
    int shown = Math.min(fields.size(), MAX_FIELDS);
    for (int i = 0; i < shown; i++) {
      JSONObject f = fields.get(i);
      String pad = shown > 1 ? "   " : "";
      if (i > 0) sb.append('\n');
      String t = clean(f.optString("title", ""));
      String d = clean(f.optString("description", ""));
      boolean any = false;
      if (!t.isEmpty()) {
        sb.append(shown > 1 ? (i + 1) + ". " : "").append(Text.clip(Text.redact(t), 200));
        any = true;
      }
      if (!d.isEmpty() && !d.equals(t)) {
        if (any) sb.append('\n').append(pad);
        else if (shown > 1) sb.append(i + 1).append(". ");
        sb.append(Text.clip(Text.redact(d), 300));
        any = true;
      }
      if (!any) sb.append(shown > 1 ? (i + 1) + ". " : "").append("Needs your input");
      String opts = options(f);
      if (!opts.isEmpty()) sb.append('\n').append(pad).append(opts);
    }
    if (fields.size() > shown) sb.append("\n(+").append(fields.size() - shown).append(" more)");
    return new Detail(line, Text.clip(sb.toString(), FULL_MAX));
  }

  /** A permission request ({@code {action, resources:[...]}}): what it wants, in words. */
  public static Detail permission(JSONObject data) {
    String action = data == null ? "" : data.optString("action", "");
    boolean safeAction = ACTION.matcher(action).matches();
    List<String> res = resources(data);
    if (!safeAction && res.isEmpty()) return new Detail("Permission requested", null);
    String verb = safeAction ? verbOf(action) : "Permission";
    if (res.isEmpty()) return new Detail(Text.clip(Text.redact(verb), LINE_MAX), null);
    String more = res.size() > 1 ? " (+" + (res.size() - 1) + " more)" : "";
    String head = verb + ": ";
    int room = Math.max(10, LINE_MAX - head.length() - more.length());
    String line = head + Text.clip(Text.redact(res.get(0)), room) + more;
    if (res.size() == 1) {
      return new Detail(line, Text.clip(head + Text.redact(res.get(0)), FULL_MAX));
    }
    StringBuilder sb = new StringBuilder(verb).append(':');
    int shown = Math.min(res.size(), MAX_RESOURCES);
    for (int i = 0; i < shown; i++) sb.append("\n\u2022 ").append(Text.clip(Text.redact(res.get(i)), 200));
    if (res.size() > shown) sb.append("\n(+").append(res.size() - shown).append(" more)");
    return new Detail(line, Text.clip(sb.toString(), FULL_MAX));
  }

  // --- internals ---

  /** {@code shell} -> "Run", {@code edit} -> "Edit", anything else its own name. */
  static String verbOf(String action) {
    switch (action.toLowerCase(Locale.ROOT)) {
      case "bash":
      case "shell":
      case "command":
        return "Run";
      case "edit":
      case "multiedit":
      case "patch":
      case "apply_patch":
        return "Edit";
      case "write":
        return "Write";
      case "read":
        return "Read";
      case "webfetch":
        return "Fetch";
      case "external_directory":
        return "Folder";
      default:
        return action;
    }
  }

  private static List<String> resources(JSONObject data) {
    List<String> out = new ArrayList<>();
    JSONArray a = data == null ? null : data.optJSONArray("resources");
    if (a == null) return out;
    for (int i = 0; i < a.length(); i++) {
      String s = a.optString(i, "");
      s = Text.squash(s);
      if (!s.isEmpty()) out.add(s);
    }
    return out;
  }

  private static List<JSONObject> visibleFields(JSONObject form) {
    List<JSONObject> all = new ArrayList<>();
    List<JSONObject> shown = new ArrayList<>();
    JSONArray a = form == null ? null : form.optJSONArray("fields");
    if (a == null) return shown;
    for (int i = 0; i < a.length(); i++) {
      JSONObject f = a.optJSONObject(i);
      if (f == null) continue;
      all.add(f);
      if (!f.optBoolean("hidden", false)) shown.add(f);
    }
    return shown.isEmpty() ? all : shown;
  }

  /** The question of one field: its title, and when the title is short, its description too. */
  static String questionOf(JSONObject f) {
    String t = clean(f.optString("title", ""));
    String d = clean(f.optString("description", ""));
    if (t.isEmpty()) return d;
    if (d.isEmpty() || d.startsWith(t)) return t;
    if (t.length() < SHORT_TITLE) return t + DASH + d;
    return t;
  }

  private static String options(JSONObject f) {
    List<String> labels = new ArrayList<>();
    JSONArray a = f.optJSONArray("options");
    if (a != null) {
      for (int i = 0; i < a.length(); i++) {
        JSONObject o = a.optJSONObject(i);
        String label = o == null ? clean(a.optString(i, "")) : clean(o.optString("label", o.optString("value", "")));
        if (!label.isEmpty()) labels.add(Text.clip(Text.redact(label), 60));
      }
    } else if ("boolean".equals(f.optString("type", ""))) {
      labels.add("Yes");
      labels.add("No");
    }
    if (labels.isEmpty()) return "";
    StringBuilder sb = new StringBuilder("Options: ");
    int shown = Math.min(labels.size(), MAX_OPTIONS);
    for (int i = 0; i < shown; i++) sb.append(i > 0 ? DOT : "").append(labels.get(i));
    if (labels.size() > shown) sb.append(DOT).append("\u2026");
    return sb.toString();
  }

  private static String clean(String s) {
    return Markdown.inline(s == null ? "" : s);
  }

  /** Non-empty lines of a plain text (an error message): whitespace squashed, markdown left alone. */
  private static List<String> plainLines(String text) {
    List<String> out = new ArrayList<>();
    if (text == null) return out;
    for (String l : text.split("\\r?\\n|\\r")) {
      String s = Text.squash(l);
      if (!s.isEmpty()) out.add(s);
    }
    return out;
  }

  private static String join(List<String> lines, int maxLines) {
    StringBuilder sb = new StringBuilder();
    int n = Math.min(lines.size(), maxLines);
    for (int i = 0; i < n; i++) {
      if (i > 0) sb.append('\n');
      sb.append(lines.get(i));
    }
    return Text.clip(Text.redact(sb.toString()), FULL_MAX);
  }
}
