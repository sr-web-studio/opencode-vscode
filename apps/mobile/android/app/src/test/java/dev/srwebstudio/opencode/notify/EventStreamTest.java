package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

public class EventStreamTest {
  private static final ServerRef SERVER = new ServerRef("srv-1", "Home server", "http://h:4096", "pw", "my-server");

  /** A scripted server: each open() takes the next step. */
  private static final class Script implements EventStream.Transport {
    interface Step {
      EventStream.Connection open() throws IOException;
    }

    final List<Step> steps = new ArrayList<>();
    int opens = 0;
    EventStream stream;

    @Override
    public EventStream.Connection open(ServerRef s) throws IOException {
      if (opens >= steps.size()) {
        stream.stop();
        throw new IOException("script over");
      }
      return steps.get(opens++).open();
    }
  }

  private static EventStream.Connection body(final String text) {
    return new EventStream.Connection() {
      @Override
      public Reader reader() {
        return new StringReader(text);
      }

      @Override
      public void close() {}
    };
  }

  private static EventStream.Connection timingOut() {
    return new EventStream.Connection() {
      @Override
      public Reader reader() {
        return new Reader() {
          @Override
          public int read(char[] b, int o, int l) throws IOException {
            throw new SocketTimeoutException("Read timed out");
          }

          @Override
          public void close() {}
        };
      }

      @Override
      public void close() {}
    };
  }

  private static final class Rec implements EventStream.Listener {
    final List<String> log = Collections.synchronizedList(new ArrayList<String>());

    @Override
    public void onConnected(ServerRef s) {
      log.add("connected");
    }

    @Override
    public void onEvent(ServerRef s, JSONObject e) {
      log.add("event:" + e.optString("type"));
    }

    @Override
    public void onDisconnected(ServerRef s, String reason) {
      log.add("down:" + reason);
    }

    @Override
    public void onActivity(ServerRef s) {}
  }

  private static final class FakeSleeper implements EventStream.Sleeper {
    final List<Long> waits = new ArrayList<>();

    @Override
    public void sleep(long ms) {
      waits.add(ms);
    }

    @Override
    public void wake() {}
  }

  @Test
  public void deliversEventsThenReconnectsWithBackoff() {
    Script script = new Script();
    script.steps.add(() -> body("data: {\"type\":\"a\"}\n\n: heartbeat\n\ndata: {\"type\":\"b\"}\n\n"));
    script.steps.add(() -> {
      throw new IOException("HTTP 502");
    });
    script.steps.add(() -> {
      throw new IOException("HTTP 502");
    });
    script.steps.add(() -> body("data: {\"type\":\"c\"}\n\n"));
    Rec rec = new Rec();
    FakeSleeper sleeper = new FakeSleeper();
    EventStream s = new EventStream(SERVER, script, rec, sleeper);
    script.stream = s;
    s.run();
    assertEquals(List.of("connected", "event:a", "event:b", "down:closed", "down:HTTP 502", "down:HTTP 502", "connected", "event:c", "down:closed"), rec.log);
    // after a connection that delivered bytes the wait restarts at 1 s; two failures in a row: 1 s then 2 s
    assertEquals(List.of(1_000L, 1_000L, 2_000L, 1_000L), sleeper.waits.subList(0, 4));
  }

  @Test
  public void failuresBackOffUpToThirtySeconds() {
    Script script = new Script();
    for (int i = 0; i < 8; i++) {
      script.steps.add(() -> {
        throw new IOException("HTTP 502");
      });
    }
    FakeSleeper sleeper = new FakeSleeper();
    EventStream s = new EventStream(SERVER, script, new Rec(), sleeper);
    script.stream = s;
    s.run();
    assertEquals(List.of(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L, 30_000L), sleeper.waits.subList(0, 8));
  }

  @Test
  public void silentConnectionIsTreatedAsDead() {
    Script script = new Script();
    script.steps.add(EventStreamTest::timingOut);
    script.steps.add(() -> body("data: {\"type\":\"after\"}\n\n"));
    Rec rec = new Rec();
    EventStream s = new EventStream(SERVER, script, rec, new FakeSleeper());
    script.stream = s;
    s.run();
    assertEquals("connected", rec.log.get(0));
    assertEquals("down:no data for a while", rec.log.get(1));
    assertTrue(rec.log.contains("event:after"));
  }

  @Test
  public void garbageDataIsIgnored() {
    Script script = new Script();
    script.steps.add(() -> body("data: not json\n\ndata: {\"type\":\"ok\"}\n\n"));
    Rec rec = new Rec();
    EventStream s = new EventStream(SERVER, script, rec, new FakeSleeper());
    script.stream = s;
    s.run();
    assertEquals(1, rec.log.stream().filter(l -> l.startsWith("event:")).count());
  }

  @Test
  public void kickReconnectsWithoutWaiting() {
    final Script script = new Script();
    final FakeSleeper sleeper = new FakeSleeper();
    final Rec rec = new Rec();
    final EventStream[] holder = new EventStream[1];
    script.steps.add(
        () ->
            new EventStream.Connection() {
              @Override
              public Reader reader() {
                holder[0].kick();
                return new StringReader("");
              }

              @Override
              public void close() {}
            });
    script.steps.add(() -> body("data: {\"type\":\"x\"}\n\n"));
    EventStream s = new EventStream(SERVER, script, rec, sleeper);
    holder[0] = s;
    script.stream = s;
    s.run();
    assertTrue(rec.log.contains("down:network changed"));
    assertTrue("no backoff wait after a kick before the next connect", sleeper.waits.isEmpty() || sleeper.waits.get(0) != 1_000L || rec.log.indexOf("down:network changed") < rec.log.indexOf("event:x"));
    assertTrue(rec.log.contains("event:x"));
  }
}
