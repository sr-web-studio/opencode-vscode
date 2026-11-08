package dev.srwebstudio.opencode.notify;

import java.nio.charset.StandardCharsets;

/** The server's basic auth (user {@code opencode}). Own Base64: java.util.Base64 needs API 26 and minSdk is 24. */
public final class Auth {
  private Auth() {}

  private static final char[] ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

  /** The {@code Authorization} header value for this password or token; null when there is none. */
  public static String basic(String password) {
    if (password == null || password.isEmpty()) return null;
    return "Basic " + base64(("opencode:" + password).getBytes(StandardCharsets.UTF_8));
  }

  static String base64(byte[] in) {
    StringBuilder out = new StringBuilder((in.length + 2) / 3 * 4);
    for (int i = 0; i < in.length; i += 3) {
      int b0 = in[i] & 0xff;
      int b1 = i + 1 < in.length ? in[i + 1] & 0xff : 0;
      int b2 = i + 2 < in.length ? in[i + 2] & 0xff : 0;
      out.append(ALPHABET[b0 >> 2]);
      out.append(ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]);
      out.append(i + 1 < in.length ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=');
      out.append(i + 2 < in.length ? ALPHABET[b2 & 63] : '=');
    }
    return out.toString();
  }
}
