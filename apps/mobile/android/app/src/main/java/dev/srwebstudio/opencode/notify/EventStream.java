package dev.srwebstudio.opencode.notify;

import java.io.Closeable;
import java.io.IOException;
import java.io.Reader;
import java.net.SocketTimeoutException;
import org.json.JSONObject;

/**
 * One server's event stream, kept alive for ever: connect, parse, and on any end (EOF, error, or no byte for the
 * transport's read timeout, which is 60 s) wait with {@link Backoff} and connect again. {@link #kick} reconnects at once
 * (the network changed). The transport, the clock and the sleep are injectable so the loop is unit-tested.
 */
public final class EventStream {
  /** An open response: the body as text. Closing it aborts a blocked read. */
  public interface Connection extends Closeable {
    Reader reader();
  }

  public interface Transport {
    /** Connect and return once the response headers are in. Throws on a bad status (message has no secrets). */
    Connection open(ServerRef server) throws IOException;
  }

  public interface Listener {
    void onConnected(ServerRef server);

    void onEvent(ServerRef server, JSONObject event);

    void onDisconnected(ServerRef server, String reason);

    /** Any bytes arrived (events and heartbeats alike). */
    void onActivity(ServerRef server);
  }

  public interface Sleeper {
    /** Wait up to {@code ms}; return early when {@link #wake} is called. */
    void sleep(long ms) throws InterruptedException;

    void wake();
  }

  /** The real sleeper: a monitor wait that {@link #wake} cuts short. */
  public static final class MonitorSleeper implements Sleeper {
    private boolean woken;

    @Override
    public synchronized void sleep(long ms) throws InterruptedException {
      long end = System.currentTimeMillis() + ms;
      while (!woken) {
        long left = end - System.currentTimeMillis();
        if (left <= 0) break;
        wait(left);
      }
      woken = false;
    }

    @Override
    public synchronized void wake() {
      woken = true;
      notifyAll();
    }
  }

  private final ServerRef server;
  private final Transport transport;
  private final Listener listener;
  private final Sleeper sleeper;
  private volatile boolean stopped;
  private volatile Connection current;
  private volatile boolean kicked;

  public EventStream(ServerRef server, Transport transport, Listener listener, Sleeper sleeper) {
    this.server = server;
    this.transport = transport;
    this.listener = listener;
    this.sleeper = sleeper;
  }

  public ServerRef server() {
    return server;
  }

  /** Blocks until {@link #stop}. Run it on its own thread. */
  public void run() {
    int attempt = 0;
    while (!stopped) {
      String reason = "closed";
      boolean gotBytes = false;
      kicked = false;
      try (Connection c = transport.open(server)) {
        current = c;
        if (stopped) break;
        listener.onConnected(server);
        SseParser parser =
            new SseParser(
                new SseParser.Listener() {
                  @Override
                  public void onData(String data) {
                    try {
                      listener.onEvent(server, new JSONObject(data));
                    } catch (org.json.JSONException ignored) {
                      // not an event envelope: nothing to do
                    }
                  }

                  @Override
                  public void onComment(String comment) {}
                });
        char[] buf = new char[4096];
        Reader r = c.reader();
        int n;
        while (!stopped && (n = r.read(buf)) >= 0) {
          if (n == 0) continue;
          gotBytes = true;
          attempt = 0;
          listener.onActivity(server);
          parser.feed(buf, n);
        }
      } catch (SocketTimeoutException e) {
        reason = "no data for a while";
      } catch (IOException e) {
        reason = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
      } catch (RuntimeException e) {
        reason = e.getClass().getSimpleName();
      } finally {
        current = null;
      }
      if (stopped) break;
      listener.onDisconnected(server, kicked ? "network changed" : reason);
      if (kicked) {
        attempt = 0;
        continue;
      }
      try {
        sleeper.sleep(Backoff.delayMs(gotBytes ? 0 : attempt));
      } catch (InterruptedException e) {
        break;
      }
      if (!gotBytes) attempt++;
    }
  }

  /** Reconnect now: drop the connection and skip the wait. */
  public void kick() {
    kicked = true;
    Connection c = current;
    if (c != null) {
      try {
        c.close();
      } catch (IOException ignored) {
        // closing a dead connection
      }
    }
    sleeper.wake();
  }

  public void stop() {
    stopped = true;
    Connection c = current;
    if (c != null) {
      try {
        c.close();
      } catch (IOException ignored) {
        // closing a dead connection
      }
    }
    sleeper.wake();
  }
}
