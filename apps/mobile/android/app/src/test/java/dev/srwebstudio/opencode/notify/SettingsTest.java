package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public class SettingsTest {
  private static JSONObject json(String text) throws Exception {
    return new JSONObject(text);
  }

  @Test
  public void defaultsTurnWorkerNotificationsOffAndEverythingElseOn() {
    Settings s = Settings.defaults();
    assertTrue(s.enabled);
    assertTrue(s.permission);
    assertTrue(s.question);
    assertTrue(s.finished);
    assertTrue(s.failed);
    assertFalse("a worker ending is not worth a phone notification by default", s.workers);
    assertFalse(s.allows(Kind.WORKER));
    assertTrue(s.allows(Kind.PERMISSION));
  }

  @Test
  public void aPayloadWithoutWorkersIsOff() throws Exception {
    Settings s = Settings.fromJson(json("{\"enabled\":true}"));
    assertFalse(s.workers);
  }

  @Test
  public void theAppCanTurnWorkersOn() throws Exception {
    // The WebView always sends every switch; the absence of a version must not override what it sent.
    Settings s = Settings.fromJson(json("{\"workers\":true}"));
    assertTrue(s.workers);
    assertTrue(s.allows(Kind.WORKER));
  }

  @Test
  public void aVersionlessSavedFileReadsWorkersOff() throws Exception {
    // v1 saved the old default `workers: true`; it is read as off once, the other switches stay as saved.
    Settings s = Settings.load("{\"enabled\":false,\"permission\":false,\"question\":true,\"finished\":true,\"failed\":true,\"workers\":true}");
    assertFalse(s.enabled);
    assertFalse(s.permission);
    assertTrue(s.question);
    assertFalse("the old saved default is not a deliberate choice", s.workers);
  }

  @Test
  public void aVersionedFileKeepsWorkersOn() throws Exception {
    Settings s = Settings.load("{\"version\":2,\"workers\":true,\"finished\":false}");
    assertTrue("the owner turned it back on after the update", s.workers);
    assertFalse(s.finished);
  }

  @Test
  public void missingOrBrokenFilesGetTheDefaults() {
    assertFalse(Settings.load(null).workers);
    assertFalse(Settings.load("").workers);
    assertFalse(Settings.load("{not json").workers);
  }

  @Test
  public void savedJsonCarriesTheVersion() throws Exception {
    JSONObject o = Settings.defaults().toJson();
    assertEquals(Settings.VERSION, o.getInt("version"));
    assertFalse(o.getBoolean("workers"));
    // A round trip through the saved shape keeps the switches.
    Settings on = new Settings(true, true, true, true, true, true);
    assertTrue(Settings.load(on.toJson().toString()).workers);
  }
}
