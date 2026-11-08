package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.IOException;
import java.net.SocketTimeoutException;
import org.junit.Test;

public class SessionApiAnswerTest {
  private static final ServerRef SERVER = new ServerRef("srv-1", "Home server", "http://h:4096", "pw", "my-server");

  private static final String TOOL_ONLY =
      "{\"id\":\"msg_3\",\"type\":\"assistant\",\"content\":[{\"type\":\"tool\",\"name\":\"shell\",\"state\":{\"status\":\"completed\",\"input\":{\"command\":\"cat secrets\"},\"content\":[{\"type\":\"text\",\"text\":\"TOOL OUTPUT sk-abcdefghijklmnop1234\"}]}}]}";
  private static final String ANSWER =
      "{\"id\":\"msg_2\",\"type\":\"assistant\",\"content\":[{\"type\":\"reasoning\",\"text\":\"SECRET THINKING\"},{\"type\":\"text\",\"text\":\"Here is the plan:\"},{\"type\":\"text\",\"text\":\"**1.** Add login\"}]}";
  private static final String USER = "{\"id\":\"msg_1\",\"type\":\"user\",\"text\":\"USER PROMPT\",\"content\":[{\"type\":\"text\",\"text\":\"USER PROMPT\"}]}";

  private static String page(String... messages) {
    return "{\"data\":[" + String.join(",", messages) + "],\"cursor\":{\"previous\":null,\"next\":null}}";
  }

  @Test
  public void takesTextPartsOfNewestAssistantMessageOnly() throws Exception {
    String text = SessionApi.answerText(page(ANSWER, USER));
    assertEquals("Here is the plan:\n\n**1.** Add login", text);
    assertFalse(text.contains("THINKING"));
  }

  @Test
  public void skipsToolOnlyMessagesBackToTheAnswer() throws Exception {
    String text = SessionApi.answerText(page(TOOL_ONLY, ANSWER, USER));
    assertEquals("Here is the plan:\n\n**1.** Add login", text);
  }

  @Test
  public void neverReadsToolOutputOrPastTheUserMessage() throws Exception {
    assertNull(SessionApi.answerText(page(TOOL_ONLY, USER, ANSWER)));
    assertNull(SessionApi.answerText(page(TOOL_ONLY)));
    assertNull(SessionApi.answerText(page(USER)));
    assertNull(SessionApi.answerText(page()));
    assertNull(SessionApi.answerText("{\"data\":null}"));
    assertNull(SessionApi.answerText("{}"));
  }

  @Test
  public void staleAnswerOfAnEarlierTurnIsNeverReturned() throws Exception {
    String oldAnswer = "{\"id\":\"msg_old\",\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"OLD TURN ANSWER\"}]}";
    String newUser = "{\"id\":\"msg_new\",\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"second question\"}]}";
    String idle = "{\"id\":\"msg_idle\",\"type\":\"idle\"}";
    // This turn's assistant message has no text yet; the previous turn's answer sits behind the new prompt.
    assertNull(SessionApi.answerText(page(TOOL_ONLY, newUser, oldAnswer, USER)));
    assertNull(SessionApi.answerText(page(idle, newUser, oldAnswer)));
    // Other turn starters are boundaries too.
    String synthetic = "{\"id\":\"msg_syn\",\"type\":\"synthetic\",\"content\":[{\"type\":\"text\",\"text\":\"continue\"}]}";
    String skill = "{\"id\":\"msg_sk\",\"type\":\"skill\"}";
    String compaction = "{\"id\":\"msg_cp\",\"type\":\"compaction\"}";
    assertNull(SessionApi.answerText(page(synthetic, oldAnswer)));
    assertNull(SessionApi.answerText(page(skill, oldAnswer)));
    assertNull(SessionApi.answerText(page(compaction, oldAnswer)));
    // Once this turn's text is stored it wins over the old one.
    assertEquals("Here is the plan:\n\n**1.** Add login", SessionApi.answerText(page(idle, ANSWER, TOOL_ONLY, newUser, oldAnswer)));
    // Markers that do not start a turn are stepped over.
    String switched = "{\"id\":\"m\",\"type\":\"model-switched\"}";
    assertEquals("Here is the plan:\n\n**1.** Add login", SessionApi.answerText(page(switched, ANSWER, USER)));
  }

  @Test
  public void lastAnswerOnAStaleThenFreshPageSequence() throws Exception {
    final String oldAnswer = "{\"id\":\"msg_old\",\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"OLD\"}]}";
    final String newUser = "{\"id\":\"u2\",\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"q2\"}]}";
    final int[] n = {0};
    SessionApi.Fetch fetch = (s, p, c, r, m) -> ++n[0] == 1 ? page(newUser, oldAnswer, USER) : page(ANSWER, newUser, oldAnswer, USER);
    assertNull("first look: stale answer hidden", SessionApi.lastAnswer(fetch, SERVER, "ses_x"));
    assertEquals("second look: this turn's answer", "Here is the plan:\n\n**1.** Add login", SessionApi.lastAnswer(fetch, SERVER, "ses_x"));
  }

  @Test
  public void ignoresBlankTextAndOtherMessageTypes() throws Exception {
    String blank = "{\"id\":\"m\",\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"  \\n\"}]}";
    String shell = "{\"id\":\"s\",\"type\":\"shell\",\"content\":[{\"type\":\"text\",\"text\":\"SHELL OUT\"}]}";
    assertNull(SessionApi.answerText(page(blank, shell, USER)));
    assertEquals("Here is the plan:\n\n**1.** Add login", SessionApi.answerText(page(shell, blank, ANSWER, USER)));
  }

  @Test
  public void asksForTheNewestFewMessagesWithinFiveSeconds() throws Exception {
    final String[] seen = new String[3];
    SessionApi.Fetch fetch =
        (server, path, connect, read, max) -> {
          seen[0] = path;
          seen[1] = connect + "/" + read;
          return page(ANSWER, USER);
        };
    assertEquals("Here is the plan:\n\n**1.** Add login", SessionApi.lastAnswer(fetch, SERVER, "ses_x"));
    assertEquals("/api/session/ses_x/message?order=desc&limit=" + SessionApi.ANSWER_PAGE, seen[0]);
    assertTrue(SessionApi.ANSWER_CONNECT_MS + SessionApi.ANSWER_READ_MS <= 5_000);
    assertEquals("2000/3000", seen[1]);
  }

  @Test
  public void timeoutAndHttpErrorsPropagateSoTheEngineFallsBack() {
    try {
      SessionApi.lastAnswer((s, p, c, r, m) -> { throw new SocketTimeoutException("read timed out"); }, SERVER, "ses_x");
      fail("expected timeout");
    } catch (SocketTimeoutException expected) {
      // the engine turns this into "Finished"
    } catch (Exception e) {
      fail("wrong exception " + e);
    }
    try {
      SessionApi.lastAnswer((s, p, c, r, m) -> { throw new IOException("HTTP 404"); }, SERVER, "ses_x");
      fail("expected 404");
    } catch (IOException expected) {
      assertEquals("HTTP 404", expected.getMessage());
    } catch (Exception e) {
      fail("wrong exception " + e);
    }
  }

  @Test
  public void emptyAndGarbageResponses() throws Exception {
    assertNull(SessionApi.lastAnswer((s, p, c, r, m) -> page(), SERVER, "ses_x"));
    try {
      SessionApi.lastAnswer((s, p, c, r, m) -> "<html>nope</html>", SERVER, "ses_x");
      fail("expected a parse error");
    } catch (org.json.JSONException expected) {
      // the engine turns this into "Finished"
    }
  }

  @Test
  public void sessionMetaThroughTheSameFetch() throws Exception {
    SessionApi.Fetch fetch = (s, p, c, r, m) -> "{\"data\":{\"title\":\"T\",\"location\":{\"directory\":\"/a/b\"}}}";
    SessionMeta m = SessionApi.get(fetch, SERVER, "ses_x");
    assertEquals("T", m.title);
    assertEquals("/a/b", m.directory);
  }
}
