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
  private static final ServerRef SERVER = new ServerRef("srv-1", "Office", "http://h:4096", "pw", "office");

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
