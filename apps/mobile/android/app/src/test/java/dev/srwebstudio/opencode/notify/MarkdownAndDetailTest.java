package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

public class MarkdownAndDetailTest {
  private static JSONObject json(String s) {
    try {
      return new JSONObject(s);
    } catch (org.json.JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  // --- markdown ---

  @Test
  public void stripsHeadingsBulletsEmphasisCodeAndLinks() {
    assertEquals(List.of("Plan"), Markdown.lines("## Plan"));
    assertEquals(List.of("Add login"), Markdown.lines("- Add login"));
    assertEquals(List.of("Add login"), Markdown.lines("* [ ] Add login"));
    assertEquals(List.of("1. Add login"), Markdown.lines("**1.** Add login"));
    assertEquals(List.of("Run bun test now"), Markdown.lines("Run `bun test` now"));
    assertEquals(List.of("See the docs for more"), Markdown.lines("See [the docs](https://x.y/z?a=1) for more"));
    assertEquals(List.of("a bold and italic word"), Markdown.lines("a __bold__ and *italic* word"));
    assertEquals(List.of("quoted text"), Markdown.lines("> quoted text"));
    assertEquals(List.of("logo"), Markdown.lines("![logo](a.png)"));
    assertEquals(List.of("snake_case_name stays"), Markdown.lines("snake_case_name stays"));
    assertEquals(List.of("2 * 3 = 6"), Markdown.lines("2 * 3 = 6"));
  }

  @Test
  public void skipsEmptyFenceRuleAndCodeLines() {
    String md = "\n\n```java\nint x = 1;\n```\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\nDone.";
    assertEquals(List.of("a \u00b7 b", "1 \u00b7 2", "Done."), Markdown.lines(md));
    assertEquals(List.of("After code"), Markdown.lines("```\nrm -rf /\n```\nAfter code"));
    assertEquals(List.of(), Markdown.lines("```\nonly code"));
    assertEquals(List.of(), Markdown.lines(null));
    assertEquals(List.of(), Markdown.lines("   \n\t\n"));
    assertEquals(List.of(), Markdown.lines("***\n---\n___"));
  }

  @Test
  public void firstMeaningfulLineOfAnAnswer() {
    Detail d = Detail.answer("\n## Summary\n\nI added the **login** form with `useAuth`.\n\n- one\n- two");
    assertEquals("Summary", d.line);
    Detail e = Detail.answer("```\ncode\n```\n\nHere is the plan:\n\n**1.** Add login\n**2.** Add logout");
    assertEquals("Here is the plan:", e.line);
    assertEquals("Here is the plan:\n1. Add login\n2. Add logout", e.full);
  }

  @Test
  public void answerClipsLineAndFullText() {
    Detail d = Detail.answer("word ".repeat(100));
    assertEquals(Detail.LINE_MAX, d.line.length());
    assertTrue(d.line.endsWith("\u2026"));
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 30; i++) sb.append("Line number ").append(i).append(" with some words in it to fill space.\n\n");
    Detail f = Detail.answer(sb.toString());
    assertTrue(f.full.length() <= Detail.FULL_MAX);
    assertTrue("a few lines, not all", f.full.split("\n").length <= Detail.FULL_LINES);
  }

  @Test
  public void answerWithoutTextReadsFinished() {
    assertEquals("Finished", Detail.answer(null).line);
    assertEquals("Finished", Detail.answer("").line);
    assertEquals("Finished", Detail.answer("```\nonly code\n```").line);
    assertEquals("Finished", Detail.answer("Finished").full);
  }

  @Test
  public void answerIsRedacted() {
    Detail d = Detail.answer("Use password=hunter2hunter2 for the db\nsecond sk-abcdefghijklmnop1234");
    assertFalse(d.line.contains("hunter2"));
    assertTrue(d.line.contains("password=[redacted]"));
    assertFalse(d.full.contains("sk-abcdefghijklmnop1234"));
  }

  // --- error ---

  @Test
  public void errorShowsFirstLineAndFallsBack() {
    Detail d = Detail.error("Provider returned 500\nat x.js:1\nat y.js:2");
    assertEquals("Provider returned 500", d.line);
    assertEquals("Provider returned 500\nat x.js:1\nat y.js:2", d.full);
    assertEquals("The turn failed", Detail.error("  ").line);
    assertEquals("The turn failed", Detail.error(null).line);
    assertTrue(Detail.error("401 Bearer abcdefghijklmnopqrstuv").line.contains("Bearer [redacted]"));
  }

  // --- question ---

  private static final String ONE =
      "{\"id\":\"frm_1\",\"title\":\"Questions\",\"fields\":[{\"key\":\"q0\",\"title\":\"Phone is on the lock screen\",\"description\":\"After 3+ min of screen-off\",\"type\":\"string\"}]}";

  @Test
  public void shortGenericTitleGetsItsDescription() {
    Detail d = Detail.question(json("{\"title\":\"Questions\",\"fields\":[{\"key\":\"q\",\"title\":\"Colour\",\"description\":\"Do you like blue?\",\"type\":\"string\"}]}"));
    assertEquals("Colour \u2014 Do you like blue?", d.line);
    Detail e = Detail.question(json(ONE));
    assertEquals("Phone is on the lock screen \u2014 After 3+ min of screen-off", e.line);
  }

  @Test
  public void longTitleStandsAlone() {
    String q = "Should the background service restart itself after a reboot of the phone?";
    Detail d = Detail.question(json("{\"title\":\"Q\",\"fields\":[{\"key\":\"q\",\"title\":\"" + q + "\",\"description\":\"Extra detail\",\"type\":\"string\"}]}"));
    assertEquals(q, d.line);
    assertTrue(d.full.contains("Extra detail"));
  }

  @Test
  public void titleOrDescriptionOnly() {
    assertEquals("Pick one", Detail.question(json("{\"title\":\"X\",\"fields\":[{\"key\":\"q\",\"title\":\"Pick one\",\"type\":\"string\"}]}")).line);
    assertEquals("Which colour do you like?", Detail.question(json("{\"title\":\"X\",\"fields\":[{\"key\":\"q\",\"description\":\"Which colour do you like?\",\"type\":\"string\"}]}")).line);
    assertEquals("Colour", Detail.question(json("{\"title\":\"X\",\"fields\":[{\"key\":\"q\",\"title\":\"Colour\",\"description\":\"Colour of the sky\",\"type\":\"string\"}]}")).line);
  }

  @Test
  public void formTitleAndEmptyFallbacks() {
    assertEquals("Deploy settings", Detail.question(json("{\"title\":\"Deploy settings\",\"fields\":[{\"key\":\"q\",\"type\":\"string\"}]}")).line);
    assertEquals("Needs your input", Detail.question(json("{\"title\":\"\",\"fields\":[]}")).line);
    assertEquals("Needs your input", Detail.question(null).line);
  }

  @Test
  public void severalFieldsShowFirstPlusCount() {
    String form =
        "{\"title\":\"Setup\",\"fields\":["
            + "{\"key\":\"a\",\"title\":\"Region\",\"description\":\"Where to deploy\",\"type\":\"string\"},"
            + "{\"key\":\"b\",\"title\":\"Size\",\"type\":\"string\"},"
            + "{\"key\":\"c\",\"title\":\"Confirm\",\"type\":\"boolean\"}]}";
    Detail d = Detail.question(json(form));
    assertEquals("Region \u2014 Where to deploy (+2 more)", d.line);
    assertTrue(d.full.contains("1. Region"));
    assertTrue(d.full.contains("2. Size"));
    assertTrue(d.full.contains("3. Confirm"));
    assertTrue(d.full.contains("Options: Yes \u00b7 No"));
  }

  @Test
  public void hiddenFieldsDoNotCount() {
    String form = "{\"title\":\"S\",\"fields\":[{\"key\":\"a\",\"title\":\"Real\",\"type\":\"string\"},{\"key\":\"b\",\"title\":\"Secret\",\"hidden\":true,\"type\":\"string\"}]}";
    assertEquals("Real", Detail.question(json(form)).line);
  }

  @Test
  public void expandedQuestionListsOptions() {
    String form =
        "{\"title\":\"T\",\"fields\":[{\"key\":\"q\",\"title\":\"Pick a database\",\"description\":\"Used for the sessions table\",\"type\":\"string\","
            + "\"options\":[{\"value\":\"a\",\"label\":\"Postgres\"},{\"value\":\"b\",\"label\":\"SQLite\"},{\"value\":\"c\",\"label\":\"MySQL\"}]}]}";
    Detail d = Detail.question(json(form));
    assertEquals("Pick a database \u2014 Used for the sessions table", d.line);
    assertEquals("Pick a database\nUsed for the sessions table\nOptions: Postgres \u00b7 SQLite \u00b7 MySQL", d.full);
  }

  @Test
  public void questionIsRedactedAndClipped() {
    Detail d = Detail.question(json("{\"title\":\"T\",\"fields\":[{\"key\":\"q\",\"title\":\"Is password=hunter2hunter2 right? " + "why ".repeat(60) + "\",\"type\":\"string\"}]}"));
    assertFalse(d.line.contains("hunter2"));
    assertTrue(d.line.length() <= Detail.LINE_MAX);
    assertFalse(d.full.contains("hunter2"));
  }

  // --- permission ---

  private static Detail perm(String action, String... resources) {
    StringBuilder r = new StringBuilder();
    for (int i = 0; i < resources.length; i++) r.append(i > 0 ? "," : "").append(JSONObject.quote(resources[i]));
    return Detail.permission(json("{\"action\":" + JSONObject.quote(action) + ",\"resources\":[" + r + "],\"message\":\"ignored token=abcd1234\"}"));
  }

  @Test
  public void permissionPhrasingPerAction() {
    assertEquals("Run: git push origin main", perm("shell", "git push origin main").line);
    assertEquals("Run: ls -la", perm("bash", "ls -la").line);
    assertEquals("Edit: src/app.ts", perm("edit", "src/app.ts").line);
    assertEquals("Write: notes.md", perm("write", "notes.md").line);
    assertEquals("Read: /etc/hosts", perm("read", "/etc/hosts").line);
    assertEquals("Fetch: https://example.com/a", perm("webfetch", "https://example.com/a").line);
    assertEquals("Folder: /opt/data", perm("external_directory", "/opt/data").line);
    assertEquals("mcp.tool: query", perm("mcp.tool", "query").line);
  }

  @Test
  public void permissionWithSeveralResources() {
    Detail d = perm("edit", "a.ts", "b.ts", "c.ts");
    assertEquals("Edit: a.ts (+2 more)", d.line);
    assertEquals("Edit:\n\u2022 a.ts\n\u2022 b.ts\n\u2022 c.ts", d.full);
  }

  @Test
  public void permissionFallbacksAndSafety() {
    assertEquals("Run", perm("shell").line);
    assertEquals("Permission requested", perm("rm -rf / ; curl x").line);
    assertEquals("Permission: ls", perm("rm -rf / ; curl x", "ls").line);
    assertEquals("Permission requested", Detail.permission(null).line);
    assertFalse(perm("shell", "x").full.contains("token"));
  }

  @Test
  public void permissionLineIsRedactedAndClipped() {
    Detail d = perm("shell", "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuv' https://x " + "a".repeat(10) + " ".repeat(2) + "word ".repeat(60));
    assertFalse(d.line.contains("abcdefghijklmnopqrstuv"));
    assertTrue(d.line.length() <= Detail.LINE_MAX);
    assertTrue(d.line.startsWith("Run: curl"));
    assertFalse(d.full.contains("abcdefghijklmnopqrstuv"));
    Detail multiline = perm("shell", "echo a\necho b");
    assertEquals("Run: echo a echo b", multiline.line);
  }
}
