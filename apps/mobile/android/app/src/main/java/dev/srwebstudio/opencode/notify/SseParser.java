package dev.srwebstudio.opencode.notify;

/**
 * Server-sent events as the OpenCode server sends them: {@code data: <json>} blocks ended by an empty line and
 * {@code : heartbeat} comment lines. Feed it text in chunks of any size; lines split between chunks and CR, LF and CRLF
 * line ends are handled. Pure Java, no Android classes.
 */
public final class SseParser {
  public interface Listener {
    /** One complete event: its {@code data} lines joined with a newline. */
    void onData(String data);

    /** A comment line (the text after the colon), e.g. {@code heartbeat}. */
    void onComment(String comment);
  }

  private final Listener listener;
  private final StringBuilder line = new StringBuilder();
  private final StringBuilder data = new StringBuilder();
  private boolean hasData;
  private boolean lastWasCR;

  public SseParser(Listener listener) {
    this.listener = listener;
  }

  public void feed(CharSequence chunk) {
    for (int i = 0; i < chunk.length(); i++) {
      char c = chunk.charAt(i);
      if (c == '\n' && lastWasCR) {
        // Second half of a CRLF: the line already ended at the CR.
        lastWasCR = false;
        continue;
      }
      lastWasCR = c == '\r';
      if (c == '\n' || c == '\r') endLine();
      else line.append(c);
    }
  }

  public void feed(char[] buffer, int length) {
    feed(java.nio.CharBuffer.wrap(buffer, 0, length));
  }

  private void endLine() {
    String l = line.toString();
    line.setLength(0);
    if (l.isEmpty()) {
      if (hasData) {
        String out = data.toString();
        data.setLength(0);
        hasData = false;
        listener.onData(out);
      }
      return;
    }
    if (l.charAt(0) == ':') {
      listener.onComment(l.substring(1).trim());
      return;
    }
    int colon = l.indexOf(':');
    String field = colon < 0 ? l : l.substring(0, colon);
    String value = colon < 0 ? "" : l.substring(colon + 1);
    if (value.startsWith(" ")) value = value.substring(1);
    if (!field.equals("data")) return; // event:, id:, retry: are not used by this server
    if (hasData) data.append('\n');
    data.append(value);
    hasData = true;
  }
}
