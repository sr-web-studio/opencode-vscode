package dev.srwebstudio.opencode.notify;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * {@code GET <base>/api/event} as an event stream. Server-wide: the server sends the events of every project when no
 * directory is asked for (checked live on 2.2.5). Only the types this app reacts to are requested, so the stream stays
 * quiet. The read timeout is the dead-connection detector: the server sends a heartbeat every 15 s, so 60 s without a
 * byte means the connection is gone.
 */
public final class HttpTransport implements EventStream.Transport {
  public static final int READ_TIMEOUT_MS = 60_000;
  private static final int CONNECT_TIMEOUT_MS = 10_000;

  public static final String[] TYPES = {
    "permission.asked",
    "permission.replied",
    "form.created",
    "form.replied",
    "form.cancelled",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.deleted",
  };

  /** The request URL: the base address, the path, and one {@code types=} per event type. */
  public static String eventUrl(String base) {
    StringBuilder sb = new StringBuilder(base.replaceAll("/+$", "")).append("/api/event");
    for (int i = 0; i < TYPES.length; i++) sb.append(i == 0 ? '?' : '&').append("types=").append(TYPES[i]);
    return sb.toString();
  }

  @Override
  public EventStream.Connection open(ServerRef server) throws IOException {
    final HttpURLConnection http = (HttpURLConnection) new URL(eventUrl(server.url)).openConnection();
    http.setConnectTimeout(CONNECT_TIMEOUT_MS);
    http.setReadTimeout(READ_TIMEOUT_MS);
    http.setRequestProperty("Accept", "text/event-stream");
    http.setRequestProperty("Accept-Encoding", "identity");
    http.setRequestProperty("Cache-Control", "no-cache");
    String auth = Auth.basic(server.password);
    if (auth != null) http.setRequestProperty("Authorization", auth);
    int status = http.getResponseCode();
    if (status != 200) {
      http.disconnect();
      // Never the response body or the URL: neither is needed to know what happened.
      throw new IOException("HTTP " + status);
    }
    final Reader reader = new InputStreamReader(http.getInputStream(), StandardCharsets.UTF_8);
    return new EventStream.Connection() {
      @Override
      public Reader reader() {
        return reader;
      }

      @Override
      public void close() {
        http.disconnect();
      }
    };
  }
}
