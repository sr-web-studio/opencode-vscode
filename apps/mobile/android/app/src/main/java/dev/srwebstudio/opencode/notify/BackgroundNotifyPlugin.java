package dev.srwebstudio.opencode.notify;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * The bridge between the app's screens and the watching service. The WebView hands over the saved servers and the
 * switches (the service keeps them, encrypted, so it can run without the WebView), says which session is on screen,
 * and asks for the Android permissions at the right moment.
 */
@CapacitorPlugin(
    name = "BackgroundNotify",
    permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public final class BackgroundNotifyPlugin extends Plugin {

  /** Save the servers and switches, then start, reload or stop the service. */
  @PluginMethod
  public void configure(PluginCall call) {
    Context ctx = getContext();
    Vault vault = new Vault(ctx);
    try {
      JSArray arr = call.getArray("servers");
      List<ServerRef> servers = new ArrayList<>();
      if (arr != null) {
        for (int i = 0; i < arr.length(); i++) {
          ServerRef s = ServerRef.fromJson(arr.getJSONObject(i));
          if (s != null) servers.add(s);
        }
      }
      JSObject settings = call.getObject("settings");
      vault.saveProfiles(servers);
      // android.provider.Settings is imported here, so this package's Settings is spelled out.
      vault.saveSettings(dev.srwebstudio.opencode.notify.Settings.fromJson(settings));
      applyService(ctx, vault, servers);
      call.resolve(status());
    } catch (JSONException | IllegalStateException e) {
      call.reject("Could not save the notification settings.");
    }
  }

  private void applyService(Context ctx, Vault vault, List<ServerRef> servers) {
    boolean want = vault.loadSettings().enabled && !servers.isEmpty();
    if (!want) {
      WatchService.stop(ctx);
      return;
    }
    // Without the permission the service still works, but no notification would show: keep it off until it is granted.
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) {
      WatchService.stop(ctx);
      return;
    }
    WatchService.start(ctx, WatchService.ACTION_RELOAD);
  }

  /** Which session is on screen (empty: none). The service does not notify for it while the app is in front. */
  @PluginMethod
  public void setVisibleSession(PluginCall call) {
    WatchState.setVisible(call.getString("serverId"), call.getString("sessionID"));
    call.resolve();
  }

  /** Remove the notification of a session (the owner opened it in the app). */
  @PluginMethod
  public void clearSession(PluginCall call) {
    String serverId = call.getString("serverId");
    String sessionID = call.getString("sessionID");
    if (serverId != null && sessionID != null) NotificationManagerCompat.from(getContext()).cancel(Notifier.tag(serverId, sessionID), 1);
    call.resolve();
  }

  @PluginMethod
  public void getStatus(PluginCall call) {
    call.resolve(status());
  }

  private JSObject status() {
    Context ctx = getContext();
    JSObject o = new JSObject();
    o.put("running", WatchState.running());
    o.put("connected", WatchState.connectedCount());
    o.put("servers", WatchState.serverCount());
    o.put("lastEventAt", WatchState.lastEventAt());
    o.put("notificationsAllowed", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
    o.put("batteryUnrestricted", ignoringBatteryOptimizations(ctx));
    JSArray list = new JSArray();
    for (Object[] s : WatchState.servers()) {
      JSObject e = new JSObject();
      e.put("id", s[0]);
      e.put("name", s[1]);
      e.put("connected", s[2]);
      list.put(e);
    }
    o.put("watching", list);
    return o;
  }

  private static boolean ignoringBatteryOptimizations(Context ctx) {
    PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
    return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
  }

  /** Ask for the notification permission (Android 13 and later). Resolves with {@code granted}. */
  @PluginMethod
  public void requestNotificationPermission(PluginCall call) {
    if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED) {
      JSObject o = new JSObject();
      o.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
      call.resolve(o);
      return;
    }
    requestPermissionForAlias("notifications", call, "notificationPermissionResult");
  }

  @PermissionCallback
  private void notificationPermissionResult(PluginCall call) {
    JSObject o = new JSObject();
    o.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
    call.resolve(o);
  }

  /** The system dialog "Let this app always run in the background?". Needs REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. */
  @PluginMethod
  public void requestBatteryExemption(PluginCall call) {
    Context ctx = getContext();
    if (ignoringBatteryOptimizations(ctx)) {
      call.resolve(status());
      return;
    }
    try {
      Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(i);
    } catch (RuntimeException e) {
      openBatterySettings(ctx);
    }
    call.resolve(status());
  }

  /** The list of battery settings (where Samsung's "Never sleeping apps" is reached from). */
  @PluginMethod
  public void openBatterySettings(PluginCall call) {
    openBatterySettings(getContext());
    call.resolve();
  }

  private static void openBatterySettings(Context ctx) {
    try {
      Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(i);
    } catch (RuntimeException e) {
      Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      ctx.startActivity(i);
    }
  }

  /** This app's notification settings (to turn a channel back on). */
  @PluginMethod
  public void openNotificationSettings(PluginCall call) {
    Context ctx = getContext();
    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    try {
      ctx.startActivity(i);
    } catch (RuntimeException e) {
      call.reject("Could not open the settings.");
      return;
    }
    call.resolve();
  }
}
