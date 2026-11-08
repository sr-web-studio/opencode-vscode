package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The catch-up after a gap: open questions and permission requests are announced once, never twice. */
public class CatchUpTest {
  private static final ServerRef SERVER = new ServerRef("srv-1", "Office", "http://h:4096", "pw", "office");

  private final List<Notice> shown = new ArrayList<>();
  private boolean visible = false;
  private Settings settings = Settings.defaults();
  private String seen = "";
  private final NoticeEngine engine = make("");

  private NoticeEngine make(String seenState) {
    return new NoticeEngine(
        new NoticeEngine.Deps() {
          @Override
          public SessionMeta session(ServerRef s, String id) {
            return new SessionMeta("Fix login", null, "/home/a/webapp");
          }

          @Override
          public String lastAnswer(ServerRef s, String id) {
            return null;
          }

          @Override
          public void pause(long ms) {}

          @Override
          public int profileCount() {
            return 1;
          }

          @Override
          public void show(Notice n) {
            shown.add(n);
          }

          @Override
          public void cancel(ServerRef s, String id) {}

          @Override
          public Settings settings() {
            return settings;
          }

          @Override
          public boolean isVisible(ServerRef s, String id) {
            return visible;
          }

          @Override
          public void seenChanged(String serialized) {
            seen = serialized;
          }

          @Override
          public long now() {
            return 1_000_000;
          }

          @Override
          public void log(String line) {}
        },
        seenState);
  }

  /** A server with fixed answers per folder. */
  private static final class Fake implements NoticeEngine.PendingSource {
    final List<String> dirs = new ArrayList<>();
    final Map<String, JSONArray> forms = new HashMap<>();
    final Map<String, JSONArray> perms = new HashMap<>();
    final List<String> failing = new ArrayList<>();
    boolean listFails = false;

    @Override
    public List<String> directories(ServerRef s) throws Exception {
      if (listFails) throw new IOException("down");
      return dirs;
    }

    @Override
    public JSONArray forms(ServerRef s, String d) throws Exception {
      if (failing.contains(d)) throw new IOException("HTTP 404");
      return forms.containsKey(d) ? forms.get(d) : new JSONArray();
    }

    @Override
    public JSONArray permissions(ServerRef s, String d) throws Exception {
      return perms.containsKey(d) ? perms.get(d) : new JSONArray();
    }
  }

  private static JSONArray arr(String json) {
    try {
      return new JSONArray(json);
    } catch (org.json.JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  private static String form(String id, String session) {
    return "{\"id\":\"" + id + "\",\"sessionID\":\"" + session + "\",\"title\":\"Questions\",\"fields\":[{\"key\":\"q\",\"title\":\"Colour\",\"type\":\"string\"}]}";
  }

  private static String perm(String id, String session) {
    return "{\"id\":\"" + id + "\",\"sessionID\":\"" + session + "\",\"action\":\"bash\",\"resources\":[\"ls\"]}";
  }

  @Test
  public void anOpenQuestionAndPermissionFromTheGapAreAnnounced() {
    Fake f = new Fake();
    f.dirs.add("/home/a/webapp");
    f.forms.put("/home/a/webapp", arr("[" + form("frm_1", "ses_a") + "]"));
    f.perms.put("/home/a/webapp", arr("[" + perm("per_1", "ses_b") + "]"));
    assertEquals(2, engine.catchUp(SERVER, f));
    assertEquals(Kind.QUESTION, shown.get(0).kind);
    assertEquals("ses_a", shown.get(0).sessionID);
    assertEquals(Kind.PERMISSION, shown.get(1).kind);
    assertEquals("opencode-mobile://session/ses_b?server=office", shown.get(1).deepLink());
  }

  @Test
  public void aSecondCatchUpAnnouncesNothingNew() {
    Fake f = new Fake();
    f.dirs.add("/d");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    assertEquals(1, engine.catchUp(SERVER, f));
    assertEquals(0, engine.catchUp(SERVER, f));
    assertEquals(1, shown.size());
  }

  @Test
  public void aLiveEventAnnouncedBeforeIsNotRepeatedByTheCatchUp() throws Exception {
    engine.handle(
        SERVER,
        new JSONObject(
            "{\"id\":\"evt_1\",\"type\":\"form.created\",\"data\":{\"form\":" + form("frm_1", "ses_a") + "}}"));
    assertEquals(1, shown.size());
    Fake f = new Fake();
    f.dirs.add("/d");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    assertEquals(0, engine.catchUp(SERVER, f));
    assertEquals(1, shown.size());
  }

  @Test
  public void whatWasAnnouncedBeforeTheServiceDiedIsNotRepeatedAfterTheRestart() {
    Fake f = new Fake();
    f.dirs.add("/d");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    engine.catchUp(SERVER, f);
    // A new engine (a new process) starts from the seen set the old one saved.
    shown.clear();
    NoticeEngine restarted = make(seen);
    assertEquals(0, restarted.catchUp(SERVER, f));
    assertTrue(shown.isEmpty());
    // A request that is new since then is announced.
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "," + form("frm_2", "ses_c") + "]"));
    assertEquals(1, restarted.catchUp(SERVER, f));
    assertEquals("ses_c", shown.get(0).sessionID);
  }

  @Test
  public void theSessionOnScreenIsSkipped() {
    visible = true;
    Fake f = new Fake();
    f.dirs.add("/d");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    assertEquals(0, engine.catchUp(SERVER, f));
  }

  @Test
  public void switchedOffKindsAreNotAnnounced() {
    settings = new Settings(true, false, false, true, true, true);
    Fake f = new Fake();
    f.dirs.add("/d");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    f.perms.put("/d", arr("[" + perm("per_1", "ses_a") + "]"));
    assertEquals(0, engine.catchUp(SERVER, f));
  }

  @Test
  public void aFailingFolderOrListDoesNotStopTheOthers() {
    Fake f = new Fake();
    f.dirs.addAll(Arrays.asList("/gone", "/d"));
    f.failing.add("/gone");
    f.forms.put("/d", arr("[" + form("frm_1", "ses_a") + "]"));
    assertEquals(1, engine.catchUp(SERVER, f));
    Fake broken = new Fake();
    broken.listFails = true;
    assertEquals(0, engine.catchUp(SERVER, broken));
  }

  @Test
  public void aBacklogIsCapped() {
    Fake f = new Fake();
    f.dirs.add("/d");
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < 20; i++) sb.append(i == 0 ? "" : ",").append(form("frm_" + i, "ses_" + i));
    f.forms.put("/d", arr(sb.append("]").toString()));
    assertEquals(NoticeEngine.CATCHUP_MAX, engine.catchUp(SERVER, f));
  }

  @Test
  public void pendingApiFoldersAreRecentFirstCappedAndDeduped() throws Exception {
    long now = 10L * 24 * 3600 * 1000;
    String json =
        "[{\"canonical\":\"/old\",\"sandboxes\":[],\"time\":{\"active\":1000}},"
            + "{\"canonical\":\"/b\",\"sandboxes\":[\"/b/wt\"],\"time\":{\"active\":" + (now - 2000) + "}},"
            + "{\"canonical\":\"/a\",\"sandboxes\":[],\"time\":{\"active\":" + (now - 1000) + "}},"
            + "{\"canonical\":\"/a\",\"sandboxes\":[],\"time\":{\"active\":" + (now - 3000) + "}}]";
    assertEquals(Arrays.asList("/a", "/b", "/b/wt"), PendingApi.folders(json, now));
  }

  @Test
  public void pendingApiBuildsTheLocationQueryAndReadsTheEnvelope() throws Exception {
    final List<String> paths = new ArrayList<>();
    PendingApi api =
        new PendingApi(
            new SessionApi.Fetch() {
              @Override
              public String get(ServerRef server, String path, int c, int r, int max) {
                paths.add(path);
                return "{\"location\":{\"directory\":\"/x\"},\"data\":[{\"id\":\"frm_1\"}]}";
              }
            },
            new java.util.function.LongSupplier() {
              @Override
              public long getAsLong() {
                return 0;
              }
            });
    assertEquals(1, api.forms(SERVER, "/tmp/occ test").length());
    assertEquals(1, api.permissions(SERVER, "/tmp/occ test").length());
    assertEquals("/api/form?location%5Bdirectory%5D=%2Ftmp%2Focc+test", paths.get(0));
    assertEquals("/api/permission/request?location%5Bdirectory%5D=%2Ftmp%2Focc+test", paths.get(1));
    assertEquals(0, PendingApi.data("{\"location\":{}}").length());
  }
}
