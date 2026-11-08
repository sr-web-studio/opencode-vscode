package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
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

  private static Notice build(Kind kind, SessionMeta meta, SessionMeta parent, Detail d, String dir, boolean multi, boolean failed) {
    return Wording.build(SERVER, "s", kind, meta, parent, d, dir, multi, failed);
  }

  @Test
  public void titleIsMarkPlusSessionTitleOnly() {
    SessionMeta m = new SessionMeta("Contra Full Setup", null, "/p/app");
    assertEquals("\u2705 Contra Full Setup", build(Kind.FINISHED, m, null, null, "/p/app", false, false).title);
    assertEquals("\u274c Contra Full Setup", build(Kind.FAILED, m, null, null, "/p/app", false, true).title);
    assertEquals("\u2753 Contra Full Setup", build(Kind.QUESTION, m, null, null, "/p/app", false, false).title);
    assertEquals("\uD83D\uDD10 Contra Full Setup", build(Kind.PERMISSION, m, null, null, "/p/app", false, false).title);
  }

  @Test
  public void fallbacksWhenThereIsNoDetail() {
    assertEquals("Finished \u00b7 app", build(Kind.FINISHED, null, null, null, "/p/app", false, false).body);
    assertEquals("The turn failed \u00b7 app", build(Kind.FAILED, null, null, null, "/p/app", false, true).body);
    assertEquals("Needs your input \u00b7 app", build(Kind.QUESTION, null, null, null, "/p/app", false, false).body);
    assertEquals("Permission requested \u00b7 app", build(Kind.PERMISSION, null, null, null, "/p/app", false, false).body);
  }

  @Test
  public void bodyAndExpandedEndWithTheFolder() {
    Detail d = Detail.answer("First line.\n\nSecond line.\n\nThird line.");
    Notice n = build(Kind.FINISHED, new SessionMeta("Refactor", null, "/p/app"), null, d, "/p/app", false, false);
    assertEquals("First line. \u00b7 app", n.body);
    assertEquals("First line.\nSecond line.\nThird line.\napp", n.expanded);
    Notice noFolder = build(Kind.FINISHED, new SessionMeta("Refactor", null, null), null, d, null, false, false);
    assertEquals("First line.", noFolder.body);
    assertEquals("First line.\nSecond line.\nThird line.", noFolder.expanded);
  }

  @Test
  public void workerGetsWorkerOfInSubText() {
    SessionMeta worker = new SessionMeta("Explore the tests", "ses_parent", "/p/app");
    SessionMeta parent = new SessionMeta("Main task", null, "/p/app");
    Notice n = build(Kind.WORKER, worker, parent, Detail.answer("Tests live in test/."), "/p/app", false, false);
    assertEquals("\u2705 Explore the tests", n.title);
    assertEquals("worker of Main task", n.subText);
    assertEquals("Tests live in test/. \u00b7 app", n.body);
    Notice multi = build(Kind.WORKER, worker, parent, null, "/p/app", true, true);
    assertEquals("\u274c Explore the tests", multi.title);
    assertEquals("worker of Main task \u00b7 Office", multi.subText);
    assertEquals("worker of an unknown session", "worker of OpenCode", build(Kind.WORKER, worker, null, null, "/p/app", false, false).subText);
  }

  @Test
  public void profileNameOnlyWithMultipleServers() {
    SessionMeta m = new SessionMeta("T", null, "/p/app");
    assertNull(build(Kind.FINISHED, m, null, null, "/p/app", false, false).subText);
    assertEquals("Office", build(Kind.FINISHED, m, null, null, "/p/app", true, false).subText);
  }

  @Test
  public void failedMessageIsRedacted() {
    SessionMeta m = new SessionMeta("T", null, "/p/app");
    Notice f = build(Kind.FAILED, m, null, Detail.error("401 with Bearer abcdefghijklmnopqrstuv"), "/p/app", false, true);
    assertFalse(f.body.contains("abcdefghijklmnopqrstuv"));
    assertTrue(f.body.contains("Bearer [redacted]"));
  }

  @Test
  public void titleIsRedactedAndClipped() {
    Notice n = build(Kind.FINISHED, new SessionMeta("deploy with password=hunter2hunter2 " + "x".repeat(200), null, null), null, null, null, false, false);
    assertFalse(n.title.contains("hunter2"));
    assertTrue(n.title.length() <= 2 + Text.TITLE_MAX + 1);
  }

  @Test
  public void deepLinkNamesSessionAndServer() {
    Notice n = Wording.build(SERVER, "ses_e4656bc8effeSAD316NuA1L1Cj", Kind.FINISHED, null, null, null, null, false, false);
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
