package dev.srwebstudio.opencode.notify;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * A small remembered set of what was already announced (request ids, turn-end keys), so a reconnect or a restart does
 * not notify twice. Oldest entries drop first. {@link #serialize} / {@link #load} let the service keep it on disk.
 */
public final class SeenSet {
  private final int max;
  private final LinkedHashSet<String> items = new LinkedHashSet<>();

  public SeenSet(int max) {
    this.max = max;
  }

  /** True when the key is new (and is now remembered); false when it was seen before. */
  public synchronized boolean add(String key) {
    if (items.contains(key)) return false;
    items.add(key);
    while (items.size() > max) {
      items.remove(items.iterator().next());
    }
    return true;
  }

  public synchronized boolean contains(String key) {
    return items.contains(key);
  }

  public synchronized int size() {
    return items.size();
  }

  /** One key per line (keys never contain a newline). */
  public synchronized String serialize() {
    return String.join("\n", items);
  }

  public synchronized void load(String text) {
    items.clear();
    if (text == null || text.isEmpty()) return;
    List<String> keys = new ArrayList<>();
    for (String k : text.split("\n")) if (!k.isEmpty()) keys.add(k);
    int from = Math.max(0, keys.size() - max);
    for (int i = from; i < keys.size(); i++) items.add(keys.get(i));
  }
}
