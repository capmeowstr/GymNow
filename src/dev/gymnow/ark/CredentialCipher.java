package dev.gymnow.ark;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Versioned authenticated encryption. Key material is supplied by Android Keystore. */
public final class CredentialCipher {
    private static final byte VERSION = 1;
    private static final byte[] CONTEXT = "dev.gymnow.ark.saved-login.v1".getBytes(StandardCharsets.UTF_8);
    private CredentialCipher() {}

    public static byte[] encrypt(SecretKey key, byte[] plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(CONTEXT);
        byte[] iv = cipher.getIV();
        if (iv.length != 12) throw new IllegalStateException("Unexpected IV length");
        byte[] encrypted = cipher.doFinal(plaintext);
        byte[] record = new byte[1 + iv.length + encrypted.length];
        record[0] = VERSION;
        System.arraycopy(iv, 0, record, 1, iv.length);
        System.arraycopy(encrypted, 0, record, 13, encrypted.length);
        return record;
    }

    public static byte[] decrypt(SecretKey key, byte[] record) throws Exception {
        if (record == null || record.length < 29 || record[0] != VERSION)
            throw new IllegalArgumentException("Invalid credential record");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOfRange(record, 1, 13)));
        cipher.updateAAD(CONTEXT);
        return cipher.doFinal(record, 13, record.length - 13);
    }
}
