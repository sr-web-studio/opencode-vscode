package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class SseParserTest {
  private final List<String> data = new ArrayList<>();
  private final List<String> comments = new ArrayList<>();
  private final SseParser parser =
      new SseParser(
          new SseParser.Listener() {
            @Override
            public void onData(String d) {
              data.add(d);
            }

            @Override
            public void onComment(String c) {
              comments.add(c);
            }
          });

  @Test
  public void oneEventAndAHeartbeat() {
    parser.feed("data: {\"type\":\"server.connected\"}\n\n: heartbeat\n\n");
    assertEquals(List.of("{\"type\":\"server.connected\"}"), data);
    assertEquals(List.of("heartbeat"), comments);
  }

  @Test
  public void eventSplitAcrossChunksAtAnyPoint() {
    String all = "data: {\"a\":1}\n\ndata: {\"b\":2}\n\n";
    for (int cut = 1; cut < all.length(); cut++) {
      data.clear();
      SseParser p =
          new SseParser(
              new SseParser.Listener() {
                @Override
                public void onData(String d) {
                  data.add(d);
                }

                @Override
                public void onComment(String c) {}
              });
      p.feed(all.substring(0, cut));
      p.feed(all.substring(cut));
      assertEquals("cut at " + cut, List.of("{\"a\":1}", "{\"b\":2}"), data);
    }
  }

  @Test
  public void crlfAndLoneCr() {
    parser.feed("data: x\r\n\r\ndata: y\r\r");
    assertEquals(List.of("x", "y"), data);
  }

  @Test
  public void crlfSplitBetweenChunks() {
    parser.feed("data: x\r");
    parser.feed("\n\r");
    parser.feed("\n");
    assertEquals(List.of("x"), data);
  }

  @Test
  public void multipleDataLinesAreJoined() {
    parser.feed("data: one\ndata: two\n\n");
    assertEquals(List.of("one\ntwo"), data);
  }

  @Test
  public void incompleteEventIsNotDelivered() {
    parser.feed("data: {\"half\":");
    parser.feed("1}\n");
    assertEquals(0, data.size());
    parser.feed("\n");
    assertEquals(List.of("{\"half\":1}"), data);
  }

  @Test
  public void otherFieldsAreIgnoredAndBlankLinesAloneDoNothing() {
    parser.feed("\n\nevent: x\nid: 5\nretry: 10\ndata: kept\n\n");
    assertEquals(List.of("kept"), data);
  }

  @Test
  public void noSpaceAfterColonAndEmptyData() {
    parser.feed("data:tight\n\ndata:\n\n");
    assertEquals(List.of("tight", ""), data);
  }

  @Test
  public void utf8TextSurvives() {
    parser.feed("data: {\"t\":\"আপনার কি নীল রঙ পছন্দ? 🙂\"}\n\n");
    assertEquals(List.of("{\"t\":\"আপনার কি নীল রঙ পছন্দ? 🙂\"}"), data);
  }
}
