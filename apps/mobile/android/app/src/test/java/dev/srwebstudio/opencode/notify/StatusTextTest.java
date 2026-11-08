package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class StatusTextTest {
  private static final long NOW = 1_000_000;

  private static StatusText.ServerStatus up(String name) {
    return new StatusText.ServerStatus(name, true, null, 0);
  }

  /** Never connected, never tried. */
  private static StatusText.ServerStatus fresh(String name) {
    return new StatusText.ServerStatus(name, false, null, 0);
  }

  private static StatusText.ServerStatus down(String name, String reason, long agoMs) {
    return new StatusText.ServerStatus(name, false, reason, NOW - agoMs);
  }

  private static String text(StatusText.ServerStatus... s) {
    return StatusText.text(Arrays.asList(s), NOW);
  }

  @Test
  public void watchingOnlyWhenEveryStreamIsConnected() {
    assertEquals("Watching 1 server", text(up("A")));
    assertEquals("Watching 2 servers", text(up("A"), up("B")));
  }

  @Test
  public void noServers() {
    assertEquals("No servers to watch", StatusText.text(Collections.<StatusText.ServerStatus>emptyList(), NOW));
  }

  @Test
  public void neverSaysWatchingWhenNothingIsConnected() {
    assertEquals("Connecting\u2026", text(fresh("A")));
    assertEquals("Connecting\u2026", text(fresh("A"), fresh("B")));
    assertFalse(text(down("A", "closed", 1_000)).startsWith("Watching"));
    assertFalse(text(down("A", "closed", 600_000)).startsWith("Watching"));
  }

  @Test
  public void aFreshDropIsReconnecting() {
    assertEquals("Reconnecting\u2026", text(down("A", "closed", 5_000)));
    assertEquals("Reconnecting\u2026", text(down("A", "network changed", 0)));
  }

  @Test
  public void afterTheGraceTimeTheReasonIsShownInPlainWords() {
    long late = StatusText.GRACE_MS + 1;
    assertEquals("Not connected: wrong password", text(down("A", "HTTP 401", late)));
    assertEquals("Not connected: wrong password", text(down("A", "HTTP 403", late)));
    assertEquals("Not connected: server error", text(down("A", "HTTP 502", late)));
    assertEquals("Not connected: not an OpenCode server", text(down("A", "HTTP 404", late)));
    assertEquals("Not connected: server not found", text(down("A", "Unable to resolve host \"h\": No address associated with hostname", late)));
    assertEquals("Not connected: can't reach the server", text(down("A", "failed to connect to /10.0.0.1 (port 4096) after 10000ms", late)));
    assertEquals("Not connected: can't reach the server", text(down("A", "Connection refused", late)));
    assertEquals("Not connected: no answer from the server", text(down("A", "no data for a while", late)));
    assertEquals("Not connected: connection lost", text(down("A", "closed", late)));
  }

  @Test
  public void rawFailureTextNeverReachesTheNotification() {
    String secret = "http://opencode:hunter2@10.0.0.9:4096/api/event 10.0.0.9";
    String t = text(down("A", secret, StatusText.GRACE_MS + 1));
    assertFalse(t.contains("hunter2"));
    assertFalse(t.contains("10.0.0.9"));
    assertEquals("Not connected: connection lost", t);
  }

  @Test
  public void severalServersDownNamesTheCount() {
    long late = StatusText.GRACE_MS + 1;
    assertEquals("Not connected to 2 servers: wrong password", text(down("A", "HTTP 401", late), down("B", "HTTP 401", late)));
  }

  @Test
  public void partlyConnectedSaysHowManyAndWhichOneIsDown() {
    assertEquals("Watching 1 of 2 servers \u00b7 Home: reconnecting\u2026", text(up("Home server"), down("Home", "closed", 2_000)));
    assertEquals("Watching 1 of 2 servers \u00b7 Home: can't reach the server", text(up("Home server"), down("Home", "Connection refused", StatusText.GRACE_MS + 1)));
    assertEquals("Watching 1 of 2 servers \u00b7 Home: reconnecting\u2026", text(up("Home server"), fresh("Home")));
  }

  @Test
  public void watchStateTracksTheOutageFromItsFirstFailure() {
    ServerRef s = new ServerRef("id1", "Home", "http://h:4096", "pw", "h");
    WatchState.setRunning(false);
    WatchState.setServers(Collections.singletonList(s));
    assertEquals("Connecting\u2026", StatusText.text(WatchState.statuses(), NOW));
    WatchState.setUp("id1");
    assertEquals("Watching 1 server", StatusText.text(WatchState.statuses(), NOW));
    WatchState.setDown("id1", "closed", NOW);
    assertEquals("Reconnecting\u2026", StatusText.text(WatchState.statuses(), NOW + 1_000));
    // A second failed attempt later does not restart the clock.
    WatchState.setDown("id1", "Connection refused", NOW + 20_000);
    assertEquals("Not connected: can't reach the server", StatusText.text(WatchState.statuses(), NOW + StatusText.GRACE_MS + 1));
    WatchState.setUp("id1");
    assertEquals("Watching 1 server", StatusText.text(WatchState.statuses(), NOW + 100_000));
    WatchState.setRunning(false);
    assertTrue(WatchState.statuses().isEmpty());
  }

  @Test
  public void watchdogDecision() {
    assertEquals(Watchdog.Decision.RESTART, Watchdog.decide(true, true, true, false));
    assertEquals(Watchdog.Decision.ALIVE, Watchdog.decide(true, true, true, true));
    assertEquals(Watchdog.Decision.STAND_DOWN, Watchdog.decide(false, true, true, false));
    assertEquals(Watchdog.Decision.STAND_DOWN, Watchdog.decide(true, false, true, false));
    assertEquals(Watchdog.Decision.STAND_DOWN, Watchdog.decide(true, true, false, false));
  }

  @Test
  public void serverRefToStringHasNoPasswordNorUserInfo() {
    ServerRef s = new ServerRef("id1", "Home", "http://opencode:hunter2@h:4096/", "hunter2", "h");
    String t = s.toString();
    assertFalse(t.contains("hunter2"));
    assertEquals("ServerRef(id1 http://h:4096)", t);
    List<String> none = new ArrayList<>();
    assertTrue(none.isEmpty());
  }
}
