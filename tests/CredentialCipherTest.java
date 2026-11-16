import dev.gymnow.ark.CredentialCipher;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class CredentialCipherTest {
    static int checks;
    static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("Cipher check " + checks); }
    interface Operation { void run() throws Exception; }
    static void rejects(Operation operation) throws Exception {
        boolean rejected = false;
        try { operation.run(); } catch (Exception expected) { rejected = true; }
        check(rejected);
    }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(256);
        SecretKey key = generator.generateKey(), other = generator.generateKey();
        byte[] plaintext = "{\"password\":\"test-only secret 漢字 \\n\",\"identifier\":\"user@example.test\"}".getBytes(StandardCharsets.UTF_8);
        byte[] first = CredentialCipher.encrypt(key, plaintext), second = CredentialCipher.encrypt(key, plaintext);
        check(Arrays.equals(plaintext, CredentialCipher.decrypt(key, first)));
        check(!Arrays.equals(first, second));
        check(!new String(first, StandardCharsets.UTF_8).contains("test-only secret"));
        rejects(() -> CredentialCipher.decrypt(other, first));
        byte[] changed = first.clone(); changed[changed.length - 1] ^= 1;
        rejects(() -> CredentialCipher.decrypt(key, changed));
        byte[] iv = first.clone(); iv[3] ^= 1;
        rejects(() -> CredentialCipher.decrypt(key, iv));
        byte[] version = first.clone(); version[0] = 2;
        rejects(() -> CredentialCipher.decrypt(key, version));
        rejects(() -> CredentialCipher.decrypt(key, new byte[3]));
        rejects(() -> CredentialCipher.decrypt(key, null));
        System.out.println(checks + " credential encryption checks passed");
    }
}
