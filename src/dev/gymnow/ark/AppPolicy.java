package dev.gymnow.ark;

import java.net.URI;

public final class AppPolicy {
    private AppPolicy() {}
    public static boolean officialPage(String value) {
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "arkkies.com".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }
    public static boolean officialNavigation(String value) {
        if (officialPage(value)) return true;
        try {
            URI uri = new URI(value);
            return "https".equals(uri.getScheme()) && "api.arkkies.com".equals(uri.getHost())
                && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) { return false; }
    }
    public static boolean validOutlet(String value) {
        return value != null && value.matches("[A-Z0-9]{6,16}");
    }
    public static boolean validBookingId(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{1,160}");
    }
    public static String entryUrl(String bookingId) {
        if (!validBookingId(bookingId)) throw new IllegalArgumentException("Invalid booking reference");
        return "https://arkkies.com/entry?booking-id=" + bookingId;
    }
    public static boolean verifiedEntry(String value, String expected) {
        if (!officialPage(value) || !officialPage(expected)) return false;
        try {
            URI page = new URI(value), target = new URI(expected);
            return "/entry".equals(page.getPath()) && "/entry".equals(target.getPath())
                && target.getRawQuery() != null && target.getRawQuery().startsWith("booking-id=")
                && validBookingId(target.getRawQuery().substring("booking-id=".length()))
                && target.getRawQuery().equals(page.getRawQuery());
        } catch (Exception ignored) { return false; }
    }
}
