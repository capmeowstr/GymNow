import dev.gymnow.ark.AppPolicy;

public class AppPolicyTest {
    static int checks = 0;
    static void check(boolean condition) { checks++; if (!condition) throw new AssertionError("Policy check " + checks); }
    public static void main(String[] args) {
        check(AppPolicy.officialPage("https://arkkies.com/login"));
        check(AppPolicy.officialPage("https://arkkies.com:443/portal/home"));
        check(!AppPolicy.officialPage("http://arkkies.com/login"));
        check(!AppPolicy.officialPage("https://arkkies.com.evil.test/"));
        check(!AppPolicy.officialPage("https://arkkies.com@evil.test/"));
        check(!AppPolicy.officialPage("https://evil.test@arkkies.com/"));
        check(!AppPolicy.officialPage("https://api.arkkies.com/"));
        check(AppPolicy.officialNavigation("https://api.arkkies.com/v2/auth"));
        check(!AppPolicy.officialNavigation("https://api.arkkies.com.evil.test/"));
        check(!AppPolicy.officialNavigation("javascript:alert(1)"));
        check(!AppPolicy.officialNavigation("file:///sdcard/file.html"));
        check(AppPolicy.validOutlet("AGRKHG01"));
        check(!AppPolicy.validOutlet("AGRKHG01/../../"));
        check(AppPolicy.bookingStartUrl(null) == null);
        check(AppPolicy.bookingStartUrl("") == null);
        check(AppPolicy.bookingStartUrl("AGRKHG01&pass=another") == null);
        check(AppPolicy.bookingStartUrl("AGRBIS01").equals("https://arkkies.com/portal/outlet?outlet-id=AGRBIS01"));
        check(AppPolicy.validBookingId("445749"));
        check(AppPolicy.validBookingId("cbdaf5e0-497f-455b-8178-8562d20a4932"));
        check(!AppPolicy.validBookingId("../login"));
        check(!AppPolicy.validBookingId("123&door_id=other"));
        check(AppPolicy.entryUrl("123").equals("https://arkkies.com/entry?booking-id=123"));
        check(AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=123", AppPolicy.entryUrl("123")));
        check(AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=123#door", AppPolicy.entryUrl("123")));
        check(!AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=456", AppPolicy.entryUrl("123")));
        check(!AppPolicy.verifiedEntry("https://arkkies.com/portal?booking-id=123", AppPolicy.entryUrl("123")));
        check(!AppPolicy.verifiedEntry("https://arkkies.com.evil.test/entry?booking-id=123", AppPolicy.entryUrl("123")));
        check(!AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=123&other=1", AppPolicy.entryUrl("123")));
        check(!AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=123", "https://arkkies.com/entry"));
        check(!AppPolicy.verifiedEntry("https://arkkies.com/entry?booking-id=123", "https://arkkies.com/entry?booking-id="));
        System.out.println(checks + " navigation and entry checks passed");
    }
}
