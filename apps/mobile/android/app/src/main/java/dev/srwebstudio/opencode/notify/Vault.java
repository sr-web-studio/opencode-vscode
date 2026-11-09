package dev.srwebstudio.opencode.notify;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;

/**
 * What the service needs to run without the WebView: the server profiles (with their passwords), the switches and the
 * seen set. The profiles are encrypted with an AES-GCM key that lives in the Android Keystore (never leaves it, not
 * backed up; the app has {@code allowBackup=false}). Switches and the seen set hold nothing secret.
 */
public final class Vault {
  private static final String FILE = "occ_notify";
  private static final String ALIAS = "occ_notify_profiles_v1";
  private static final String K_PROFILES = "profiles";
  private static final String K_SETTINGS = "settings";
  private static final String K_SEEN = "seen";

  private final SharedPreferences prefs;

  public Vault(Context context) {
    this.prefs = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
  }

  public synchronized void saveProfiles(List<ServerRef> servers) {
    try {
      JSONArray arr = new JSONArray();
      for (ServerRef s : servers) arr.put(s.toJson());
      prefs.edit().putString(K_PROFILES, encrypt(arr.toString())).apply();
    } catch (Exception e) {
      throw new IllegalStateException("could not store the servers: " + e.getClass().getSimpleName());
    }
  }

  /** The saved servers; empty when none, or when the key is gone (a new install of the keystore). */
  public synchronized List<ServerRef> loadProfiles() {
    List<ServerRef> out = new ArrayList<>();
    String blob = prefs.getString(K_PROFILES, null);
    if (blob == null || blob.isEmpty()) return out;
    try {
      JSONArray arr = new JSONArray(decrypt(blob));
      for (int i = 0; i < arr.length(); i++) {
        ServerRef s = ServerRef.fromJson(arr.getJSONObject(i));
        if (s != null) out.add(s);
      }
    } catch (Exception e) {
      prefs.edit().remove(K_PROFILES).apply();
    }
    return out;
  }

  public synchronized void saveSettings(Settings s) {
    try {
      prefs.edit().putString(K_SETTINGS, s.toJson().toString()).apply();
    } catch (Exception ignored) {
      // a JSON object of booleans cannot fail
    }
  }

  public synchronized Settings loadSettings() {
    return Settings.load(prefs.getString(K_SETTINGS, null));
  }

  public synchronized void saveSeen(String serialized) {
    prefs.edit().putString(K_SEEN, serialized).apply();
  }

  public synchronized String loadSeen() {
    return prefs.getString(K_SEEN, "");
  }

  private static SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (ks.containsAlias(ALIAS)) return (SecretKey) ks.getKey(ALIAS, null);
    KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    gen.init(
        new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
    return gen.generateKey();
  }

  private static String encrypt(String plain) throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.ENCRYPT_MODE, key());
    byte[] iv = c.getIV();
    byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
    byte[] all = new byte[iv.length + ct.length];
    System.arraycopy(iv, 0, all, 0, iv.length);
    System.arraycopy(ct, 0, all, iv.length, ct.length);
    return Base64.encodeToString(all, Base64.NO_WRAP);
  }

  private static String decrypt(String blob) throws Exception {
    byte[] all = Base64.decode(blob, Base64.NO_WRAP);
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, 12));
    return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
  }
}
