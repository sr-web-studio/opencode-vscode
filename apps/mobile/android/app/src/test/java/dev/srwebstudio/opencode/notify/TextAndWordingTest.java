package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TextAndWordingTest {
  private static final ServerRef SERVER = new ServerRef("srv-1", "Office", "http://10.0.0.10:4096", "secret-pass", "office-box");

  @Test
  public void redactBlanksCredentials() {
    assertEquals("Authorization: Basic [redacted]", Text.redact("Authorization: Basic b3BlbmNvZGU6c2VjcmV0cGFzcw=="));
    assertEquals("key [redacted] here", Text.redact("key sk-abcdefghijklmnop1234 here"));
    assertEquals("password=[redacted]", Text.redact("password=hunter2hunter2"));
    assertEquals("[redacted]", Text.redact("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    assertEquals("plain words stay", Text.redact("plain words stay"));
  }

  @Test
  public void clipAndFirstLine() {
    assertEquals("abc", Text.clip("abc", 5));
    assertEquals("abcd\u2026", Text.clip("abcdefgh", 5));
    assertEquals("second", Text.firstLine("\n  \nsecond\nthird"));
    assertEquals(140, Text.safe("word ".repeat(100), 140).length());
  }

  @Test
  public void clipDoesNotSplitSurrogatePair() {
    String s = "ab" + "\uD83D\uDE42".repeat(10);
    String c = Text.clip(s, 4);
    assertTrue(c.endsWith("\u2026"));
    assertFalse(Character.isHighSurrogate(c.charAt(c.length() - 2)));
  }

  @Test
  public void folderNameHandlesBothSeparators() {
    assertEquals("occ-test", Text.folderName("/tmp/opencode/occ-test"));
    assertEquals("occ-test", Text.folderName("/tmp/opencode/occ-test/"));
    assertEquals("Work", Text.folderName("D:\\Work\\"));
    assertEquals("", Text.folderName(null));
  }

  @Test
  public void permissionWording() {
    Notice n = Wording.build(SERVER, "ses_1", Kind.PERMISSION, new SessionMeta("Fix the bug", null, "/home/a/proj"), null, "bash", "/home/a/proj", false);
    assertEquals("Fix the bug needs permission", n.title);
    assertEquals("bash \u00b7 proj", n.body);
  }

  @Test
  public void questionWordingUsesFirstFieldAndClips() {
    String long140 = "why ".repeat(100);
    Notice n = Wording.build(SERVER, "ses_1", Kind.QUESTION, new SessionMeta("Plan", null, "/x/occ-test"), null, long140 + "\nsecond line", "/x/occ-test", false);
    assertEquals("Plan has a question", n.title);
    assertEquals(140 + " \u00b7 occ-test".length(), n.body.length());
    assertTrue(n.body.endsWith("\u2026 \u00b7 occ-test"));
  }

  @Test
  public void finishedAndFailed() {
    SessionMeta m = new SessionMeta("Refactor", null, "/p/app");
    assertEquals("Refactor finished", Wording.build(SERVER, "s", Kind.FINISHED, m, null, null, "/p/app", false).title);
    assertEquals("Turn finished \u00b7 app", Wording.build(SERVER, "s", Kind.FINISHED, m, null, null, "/p/app", false).body);
    Notice f = Wording.build(SERVER, "s", Kind.FAILED, m, null, "Provider error: 429\nstack line", "/p/app", true);
    assertEquals("Refactor failed", f.title);
    assertEquals("Provider error: 429 \u00b7 app", f.body);
  }

  @Test
  public void failedMessageIsRedacted() {
    SessionMeta m = new SessionMeta("T", null, "/p/app");
    Notice f = Wording.build(SERVER, "s", Kind.FAILED, m, null, "401 with Bearer abcdefghijklmnopqrstuv", "/p/app", true);
    assertFalse(f.body.contains("abcdefghijklmnopqrstuv"));
    assertTrue(f.body.contains("Bearer [redacted]"));
  }

  @Test
  public void workerWording() {
    SessionMeta worker = new SessionMeta("Explore the tests", "ses_parent", "/p/app");
    SessionMeta parent = new SessionMeta("Main task", null, "/p/app");
    Notice n = Wording.build(SERVER, "w", Kind.WORKER, worker, parent, null, "/p/app", false);
    assertEquals("Explore the tests finished (worker of Main task)", n.title);
    assertEquals("Turn finished \u00b7 app", n.body);
    Notice bad = Wording.build(SERVER, "w", Kind.WORKER, worker, parent, "boom", "/p/app", true);
    assertEquals("Explore the tests failed (worker of Main task)", bad.title);
    assertEquals("boom \u00b7 app", bad.body);
  }

  @Test
  public void unknownSessionFallsBack() {
    Notice n = Wording.build(SERVER, "s", Kind.FINISHED, null, null, null, null, false);
    assertEquals("OpenCode finished", n.title);
    assertEquals("Turn finished", n.body);
  }

  @Test
  public void deepLinkNamesSessionAndServer() {
    Notice n = Wording.build(SERVER, "ses_e4656bc8effeSAD316NuA1L1Cj", Kind.FINISHED, null, null, null, null, false);
    assertEquals("opencode-mobile://session/ses_e4656bc8effeSAD316NuA1L1Cj?server=office-box", n.deepLink());
    assertEquals("opencode-mobile://session/a%20b?server=x%26y", Notice.deepLink("x&y", "a b"));
  }

  @Test
  public void serverRefNeverPrintsThePassword() {
    assertFalse(SERVER.toString().contains("secret-pass"));
  }

  @Test
  public void basicAuthHeader() {
    assertEquals("Basic b3BlbmNvZGU6cHc=", Auth.basic("pw"));
    assertEquals("Basic b3BlbmNvZGU6cHdk", Auth.basic("pwd"));
    assertEquals("Basic b3BlbmNvZGU6cA==", Auth.basic("p"));
    assertEquals(null, Auth.basic(""));
  }

  @Test
  public void eventUrlAsksForServerWideStreamWithTypes() {
    String u = HttpTransport.eventUrl("http://h:4096/");
    assertTrue(u.startsWith("http://h:4096/api/event?types=permission.asked&types="));
    assertFalse(u.contains("directory"));
    assertTrue(u.contains("types=session.execution.failed"));
  }

  @Test
  public void backoffGrowsToThirtySeconds() {
    long[] want = {1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000};
    for (int i = 0; i < want.length; i++) assertEquals(want[i], Backoff.delayMs(i));
    assertEquals(30_000, Backoff.delayMs(500));
    assertEquals(1_000, Backoff.delayMs(-3));
  }

  @Test
  public void sessionApiParsesDataEnvelope() throws Exception {
    SessionMeta m = SessionApi.parse("{\"data\":{\"id\":\"s\",\"parentID\":\"p\",\"title\":\"T\",\"location\":{\"directory\":\"/a/b\"}}}");
    assertEquals("T", m.title);
    assertEquals("p", m.parentID);
    assertEquals("/a/b", m.directory);
    assertEquals(null, SessionApi.parse("{\"data\":{\"id\":\"s\"}}").parentID);
  }
}
