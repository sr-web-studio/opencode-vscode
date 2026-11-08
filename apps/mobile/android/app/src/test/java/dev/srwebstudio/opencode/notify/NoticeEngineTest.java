package dev.srwebstudio.opencode.notify;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

public class NoticeEngineTest {
  private static final ServerRef SERVER = new ServerRef("srv-1", "Office", "http://h:4096", "pw", "office");

  private final List<Notice> shown = new ArrayList<>();
  private final List<String> cancelled = new ArrayList<>();
  private final List<String> seenWrites = new ArrayList<>();
  private final Map<String, SessionMeta> sessions = new HashMap<>();
  private long now = 1_000_000;
  private Settings settings = Settings.defaults();
  private String visible = null;
  private int lookups = 0;
  private boolean lookupFails = false;
  private final Map<String, String> answers = new HashMap<>();
  private boolean answerFails = false;
  private int answerCalls = 0;
  /** The first N lookups find no text yet (the answer is not stored). */
  private int answerMissingFirst = 0;
  private final List<Long> pauses = new ArrayList<>();
  private int profiles = 1;
  private NoticeEngine engine;

  private NoticeEngine make(String seen) {
    return new NoticeEngine(
        new NoticeEngine.Deps() {
          @Override
          public SessionMeta session(ServerRef s, String id) throws Exception {
            lookups++;
            if (lookupFails) throw new java.io.IOException("down");
            return sessions.get(id);
          }

          @Override
          public String lastAnswer(ServerRef s, String id) throws Exception {
            answerCalls++;
            if (answerFails) throw new java.net.SocketTimeoutException("slow");
            if (answerCalls <= answerMissingFirst) return null;
            return answers.get(id);
          }

          @Override
          public void pause(long ms) {
            pauses.add(ms);
          }

          @Override
          public int profileCount() {
            return profiles;
          }

          @Override
          public void show(Notice n) {
            shown.add(n);
          }

          @Override
          public void cancel(ServerRef s, String id) {
            cancelled.add(id);
          }

          @Override
          public Settings settings() {
            return settings;
          }

          @Override
          public boolean isVisible(ServerRef s, String id) {
            return id.equals(visible);
          }

          @Override
          public void seenChanged(String serialized) {
            seenWrites.add(serialized);
          }

          @Override
          public long now() {
            return now;
          }

          @Override
          public void log(String line) {}
        },
        seen);
  }

  @Before
  public void setUp() {
    engine = make("");
    sessions.put("ses_root", new SessionMeta("Fix login", null, "/home/a/webapp"));
    sessions.put("ses_work", new SessionMeta("Read the logs", "ses_root", "/home/a/webapp"));
  }

  private static JSONObject ev(String json) {
    try {
      return new JSONObject(json);
    } catch (org.json.JSONException e) {
      throw new IllegalArgumentException(e);
    }
  }

  private static String permAsked(String id, String session, String action) {
    return "{\"id\":\"evt_" + id + "\",\"type\":\"permission.asked\",\"location\":{\"directory\":\"/home/a/webapp\"},\"data\":{\"id\":\"" + id + "\",\"sessionID\":\"" + session
        + "\",\"action\":\"" + action + "\",\"resources\":[\"rm -rf /secret/path\"],\"message\":\"Run rm -rf with a token=abcd1234\"}}";
  }

  private static String formCreated(String id, String session) {
    return "{\"id\":\"evt_" + id + "\",\"type\":\"form.created\",\"location\":{\"directory\":\"/home/a/webapp\"},\"data\":{\"form\":{\"id\":\"" + id + "\",\"sessionID\":\"" + session
        + "\",\"title\":\"Questions\",\"fields\":[{\"key\":\"q0\",\"title\":\"Colour\",\"description\":\"Do you like blue?\",\"type\":\"string\"}]}}}";
  }

  private static String turn(String evtId, String type, String session, String error) {
    String err = error == null ? "" : ",\"error\":{\"message\":\"" + error + "\"}";
    return "{\"id\":\"" + evtId + "\",\"type\":\"" + type + "\",\"data\":{\"sessionID\":\"" + session + "\"" + err + "}}";
  }

  @Test
  public void permissionAskedSaysWhatItWantsAndNeverTheMessage() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    assertEquals(1, shown.size());
    Notice n = shown.get(0);
    assertEquals("\uD83D\uDD10 Fix login", n.title);
    assertEquals("Run: rm -rf /secret/path \u00b7 webapp", n.body);
    assertEquals(Kind.PERMISSION, n.kind);
    assertTrue("the request's message text is not used", !n.body.contains("token") && !n.expanded.contains("token"));
    assertNull("one server: no sub-text", n.subText);
    assertEquals("opencode-mobile://session/ses_root?server=office", n.deepLink());
  }

  @Test
  public void formCreatedShowsTheQuestionWithTitleAndDescription() {
    engine.handle(SERVER, ev(formCreated("frm_1", "ses_root")));
    assertEquals("\u2753 Fix login", shown.get(0).title);
    assertEquals("Colour \u2014 Do you like blue? \u00b7 webapp", shown.get(0).body);
  }

  @Test
  public void rootTurnSucceededShowsTheAnswerAndFailedTheError() {
    answers.put("ses_root", "Here is the plan:\n\n**1.** Add login");
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals("\u2705 Fix login", shown.get(0).title);
    assertEquals("1. Add login \u00b7 webapp", shown.get(0).body);
    assertEquals("Here is the plan:\n1. Add login\nwebapp", shown.get(0).expanded);
    now += 6_000;
    engine.handle(SERVER, ev(turn("e2", "session.execution.failed", "ses_root", "Provider returned 500\\nat x.js:1")));
    assertEquals("\u274c Fix login", shown.get(1).title);
    assertEquals("Provider returned 500 \u00b7 webapp", shown.get(1).body);
    assertEquals(1, answerCalls);
  }

  @Test
  public void workerTurnEndNamesTheParentInTheSubText() {
    answers.put("ses_work", "Found 3 errors in the logs.");
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_work", null)));
    assertEquals("\u2705 Read the logs", shown.get(0).title);
    assertEquals("worker of Fix login", shown.get(0).subText);
    assertEquals("Found 3 errors in the logs. \u00b7 webapp", shown.get(0).body);
    assertEquals(Kind.WORKER, shown.get(0).kind);
    assertEquals("opencode-mobile://session/ses_work?server=office", shown.get(0).deepLink());
  }

  @Test
  public void failedWorkerGetsTheFailedMark() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.failed", "ses_work", "bad tool")));
    assertEquals("\u274c Read the logs", shown.get(0).title);
    assertEquals("worker of Fix login", shown.get(0).subText);
    assertEquals("bad tool \u00b7 webapp", shown.get(0).body);
  }

  @Test
  public void profileNameShownOnlyWithMoreThanOneServer() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertNull(shown.get(0).subText);
    assertNull(shown.get(0).profileName);
    profiles = 2;
    now += 6_000;
    engine.handle(SERVER, ev(turn("e2", "session.execution.succeeded", "ses_root", null)));
    assertEquals("Office", shown.get(1).subText);
    assertEquals("Office", shown.get(1).profileName);
    now += 6_000;
    engine.handle(SERVER, ev(turn("e3", "session.execution.succeeded", "ses_work", null)));
    assertEquals("worker of Fix login \u00b7 Office", shown.get(2).subText);
  }

  @Test
  public void answerLookupFailureStillNotifiesWithFinished() {
    answerFails = true;
    answers.put("ses_root", "never read");
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals(1, shown.size());
    assertEquals("\u2705 Fix login", shown.get(0).title);
    assertEquals("Finished \u00b7 webapp", shown.get(0).body);
  }

  @Test
  public void noAnswerTextReadsFinishedAfterOneRetry() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals("Finished \u00b7 webapp", shown.get(0).body);
    assertEquals("Finished\nwebapp", shown.get(0).expanded);
    assertEquals("one lookup and one retry, no more", 2, answerCalls);
    assertEquals(List.of(NoticeEngine.ANSWER_RETRY_MS), pauses);
  }

  @Test
  public void answerPresentAtFirstFetchIsNotRetried() {
    answers.put("ses_root", "All done.");
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals("All done. \u00b7 webapp", shown.get(0).body);
    assertEquals(1, answerCalls);
    assertTrue("no wait when the text is there", pauses.isEmpty());
  }

  @Test
  public void answerNotStoredYetIsFoundByTheRetry() {
    answers.put("ses_root", "Here is the plan:\n\n**1.** Add login");
    answerMissingFirst = 1;
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals(1, shown.size());
    assertEquals("1. Add login \u00b7 webapp", shown.get(0).body);
    assertEquals(2, answerCalls);
    assertEquals(List.of(700L), pauses);
  }

  @Test
  public void answerStillMissingAfterTheRetryStillNotifies() {
    answers.put("ses_root", "late text");
    answerMissingFirst = 2;
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals(1, shown.size());
    assertEquals("Finished \u00b7 webapp", shown.get(0).body);
    assertEquals(2, answerCalls);
  }

  @Test
  public void failedLookupIsNotRetried() {
    answerFails = true;
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals("Finished \u00b7 webapp", shown.get(0).body);
    assertEquals(1, answerCalls);
    assertTrue(pauses.isEmpty());
  }

  @Test
  public void answerIsRedacted() {
    answers.put("ses_root", "Set password=hunter2hunter2 and use Bearer abcdefghijklmnopqrstuv");
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertTrue(!shown.get(0).body.contains("hunter2") && !shown.get(0).body.contains("abcdefghijklmnopqrstuv"));
    assertTrue(!shown.get(0).expanded.contains("hunter2") && !shown.get(0).expanded.contains("abcdefghijklmnopqrstuv"));
  }

  @Test
  public void failedTurnDoesNotFetchTheAnswer() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.failed", "ses_root", "boom")));
    assertEquals(0, answerCalls);
    assertTrue(pauses.isEmpty());
  }

  @Test
  public void switchedOffKindsAreSkipped() {
    settings = new Settings(true, true, true, false, true, false);
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    engine.handle(SERVER, ev(turn("e2", "session.execution.succeeded", "ses_work", null)));
    assertEquals(0, shown.size());
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "edit")));
    assertEquals(1, shown.size());
  }

  @Test
  public void masterSwitchOffSkipsEverything() {
    settings = new Settings(false, true, true, true, true, true);
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "edit")));
    engine.handle(SERVER, ev(turn("e1", "session.execution.failed", "ses_root", "x")));
    assertEquals(0, shown.size());
  }

  @Test
  public void coalesceWithinFiveSecondsAttentionBeatsTurnEnd() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    now += 2_000;
    engine.handle(SERVER, ev(turn("e2", "session.execution.failed", "ses_root", "late")));
    assertEquals("second turn end inside 5 s is dropped", 1, shown.size());
    now += 500;
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    assertEquals("attention replaces", 2, shown.size());
    assertEquals(Kind.PERMISSION, shown.get(1).kind);
    now += 1_000;
    engine.handle(SERVER, ev(turn("e3", "session.execution.succeeded", "ses_root", null)));
    assertEquals("turn end after attention inside the window is dropped", 2, shown.size());
    now += 6_000;
    engine.handle(SERVER, ev(turn("e4", "session.execution.succeeded", "ses_root", null)));
    assertEquals("after the window it shows again", 3, shown.size());
  }

  @Test
  public void differentSessionsDoNotCoalesce() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    engine.handle(SERVER, ev(turn("e2", "session.execution.succeeded", "ses_work", null)));
    assertEquals(2, shown.size());
  }

  @Test
  public void sameRequestAnnouncedOnce() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    engine.handle(SERVER, ev(formCreated("frm_1", "ses_root")));
    engine.handle(SERVER, ev(formCreated("frm_1", "ses_root")));
    assertEquals(2, shown.size());
  }

  @Test
  public void sameTurnEventReplayedAfterReconnectIsDropped() {
    engine.handle(SERVER, ev(turn("evt_same", "session.execution.succeeded", "ses_root", null)));
    now += 60_000;
    engine.handle(SERVER, ev(turn("evt_same", "session.execution.succeeded", "ses_root", null)));
    assertEquals(1, shown.size());
  }

  @Test
  public void seenSetSurvivesARestart() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    String saved = seenWrites.get(seenWrites.size() - 1);
    NoticeEngine restarted = make(saved);
    restarted.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    assertEquals("not announced again after a restart", 1, shown.size());
    restarted.handle(SERVER, ev(permAsked("per_2", "ses_root", "bash")));
    assertEquals(2, shown.size());
  }

  @Test
  public void answeredPermissionCancelsItsNotification() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    engine.handle(SERVER, ev("{\"type\":\"permission.replied\",\"data\":{\"sessionID\":\"ses_root\",\"requestID\":\"per_1\"}}"));
    assertEquals(List.of("ses_root"), cancelled);
  }

  @Test
  public void answeredOrCancelledFormCancelsItsNotification() {
    engine.handle(SERVER, ev(formCreated("frm_1", "ses_root")));
    engine.handle(SERVER, ev("{\"type\":\"form.replied\",\"data\":{\"id\":\"frm_1\",\"sessionID\":\"ses_root\",\"answer\":{}}}"));
    assertEquals(List.of("ses_root"), cancelled);
    now += 10_000;
    engine.handle(SERVER, ev(formCreated("frm_2", "ses_root")));
    engine.handle(SERVER, ev("{\"type\":\"form.cancelled\",\"data\":{\"id\":\"frm_2\",\"sessionID\":\"ses_root\"}}"));
    assertEquals(List.of("ses_root", "ses_root"), cancelled);
  }

  @Test
  public void replyToAnOlderRequestKeepsTheNewerNotification() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    engine.handle(SERVER, ev(permAsked("per_2", "ses_root", "edit")));
    engine.handle(SERVER, ev("{\"type\":\"permission.replied\",\"data\":{\"sessionID\":\"ses_root\",\"requestID\":\"per_1\"}}"));
    assertEquals(0, cancelled.size());
  }

  @Test
  public void deletedSessionCancels() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    engine.handle(SERVER, ev("{\"type\":\"session.deleted\",\"data\":{\"sessionID\":\"ses_root\"}}"));
    assertEquals(List.of("ses_root"), cancelled);
  }

  @Test
  public void sessionOnScreenIsNotNotified() {
    visible = "ses_root";
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    assertEquals(0, shown.size());
    engine.handle(SERVER, ev(turn("e2", "session.execution.succeeded", "ses_work", null)));
    assertEquals("another session still notifies", 1, shown.size());
  }

  @Test
  public void lookupFailureFallsBackToGenericWording() {
    lookupFails = true;
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "bash")));
    assertEquals("\uD83D\uDD10 OpenCode", shown.get(0).title);
    assertEquals("Run: rm -rf /secret/path \u00b7 webapp", shown.get(0).body);
  }

  @Test
  public void sessionLookupIsCached() {
    engine.handle(SERVER, ev(turn("e1", "session.execution.succeeded", "ses_root", null)));
    int first = lookups;
    now += 6_000;
    engine.handle(SERVER, ev(turn("e2", "session.execution.succeeded", "ses_root", null)));
    assertEquals(first, lookups);
    now += 30_000;
    engine.handle(SERVER, ev(turn("e3", "session.execution.succeeded", "ses_root", null)));
    assertTrue(lookups > first);
  }

  @Test
  public void malformedEventsNeverThrow() {
    engine.handle(SERVER, ev("{}"));
    engine.handle(SERVER, ev("{\"type\":\"permission.asked\"}"));
    engine.handle(SERVER, ev("{\"type\":\"form.created\",\"data\":{}}"));
    engine.handle(SERVER, ev("{\"type\":\"session.execution.failed\",\"data\":{\"sessionID\":\"\"}}"));
    assertEquals(0, shown.size());
  }

  @Test
  public void unsafePermissionActionIsNotShown() {
    engine.handle(SERVER, ev(permAsked("per_1", "ses_root", "rm -rf / ; curl x")));
    assertEquals("Permission: rm -rf /secret/path \u00b7 webapp", shown.get(0).body);
    assertTrue(!shown.get(0).body.contains("curl"));
  }

  @Test
  public void seenSetIsBoundedAndOldestDrops() {
    SeenSet s = new SeenSet(3);
    for (String k : new String[] {"a", "b", "c", "d"}) s.add(k);
    assertEquals(3, s.size());
    assertTrue(!s.contains("a") && s.contains("d"));
    SeenSet t = new SeenSet(3);
    t.load(s.serialize());
    assertTrue(t.contains("b") && t.contains("d"));
    assertTrue(!t.add("d"));
  }
}
