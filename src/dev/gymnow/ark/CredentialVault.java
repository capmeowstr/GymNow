package dev.gymnow.ark;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Only ciphertext is persisted; the non-exportable encryption key stays in Android Keystore. */
public final class CredentialVault {
    private static final String ALIAS = "gym_now_saved_login_v1";
    private final SharedPreferences storage;

    public static final class Login {
        public final String identifier, password, identity;
        public Login(String identifier, String password, String identity) {
            this.identifier = identifier; this.password = password; this.identity = identity;
        }
    }

    public CredentialVault(Context context) {
        storage = context.getSharedPreferences("gym_now_credentials", Context.MODE_PRIVATE);
    }
    public boolean hasLogin() { return storage.contains("encrypted_login"); }

    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            if (!create) throw new IllegalStateException("Saved login key unavailable");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build());
            return generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }

    public Login read() throws Exception {
        if (!hasLogin()) return null;
        byte[] plaintext = CredentialCipher.decrypt(key(false),
            Base64.decode(storage.getString("encrypted_login", ""), Base64.NO_WRAP));
        try {
            JSONObject data = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
            String identifier = data.getString("identifier"), password = data.getString("password"), identity = data.getString("identity");
            if (identifier.isEmpty() || password.isEmpty() || identity.isEmpty()) throw new IllegalStateException("Incomplete saved login");
            return new Login(identifier, password, identity);
        } finally { Arrays.fill(plaintext, (byte) 0); }
    }

    public void save(Login login) throws Exception {
        if (login.identifier.isEmpty() || login.password.isEmpty() || login.identity.isEmpty())
            throw new IllegalArgumentException("Incomplete login");
        JSONObject data = new JSONObject(); data.put("identifier", login.identifier);
        data.put("password", login.password); data.put("identity", login.identity);
        byte[] plaintext = data.toString().getBytes(StandardCharsets.UTF_8);
        try {
            String record = Base64.encodeToString(CredentialCipher.encrypt(key(true), plaintext), Base64.NO_WRAP);
            if (!storage.edit().putString("encrypted_login", record).commit())
                throw new IllegalStateException("Saved login could not be written");
        } finally { Arrays.fill(plaintext, (byte) 0); }
    }

    public void clear() throws Exception {
        if (!storage.edit().clear().commit()) throw new IllegalStateException("Saved login could not be removed");
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS);
    }
}
