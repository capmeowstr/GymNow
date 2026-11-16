package dev.gymnow.ark;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class MainActivity extends Activity {
    private static final int DARK = Color.rgb(19, 60, 57);
    private static final String[][] GYMS = {
        {"AGRKHG01", "Keat Hong"}, {"AGRBIS01", "Bishan"}, {"AGRHUG01", "Hougang 423"},
        {"AGRCCK01", "Choa Chu Kang"}, {"AGRJUR01", "Jurong West 722"}, {"AGRJUR02", "Jurong West 724"},
        {"AGRGYL01", "Geylang"}, {"AGRSRN01", "Serangoon North 534"}, {"AGRSRN02", "Serangoon North 533"}
    };
    private WebView web;
    private SharedPreferences prefs;
    private CredentialVault vault;
    private TextView status;
    private TextView subtitle;
    private Button go, gymButton, accountButton, entryButton;
    private ProgressBar progress;
    private AlertDialog gymDialog;
    private boolean busy, wantRun, pageReady, destroyed, selectingDoor, doorCheckInFlight;
    private boolean signingIn, loginStarted, automaticLoginTried, manualLogin, loginDialogVisible;
    private String runToken = "", lastEntry = "", script, entryScript, loginScript;
    private String loginToken = "", loginIdentifier = "", loginPassword = "", expectedIdentity = "";
    private long runStarted, entryStarted, pageGeneration, loginStartedAt;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        prefs = getSharedPreferences("gym_now", MODE_PRIVATE);
        vault = new CredentialVault(this);
        // Keep the upgraded entry flow in the WebView, where its door can be selected.
        if (!prefs.getBoolean("mainDoorUpdate", false)) {
            prefs.edit().putBoolean("chrome", false).putBoolean("mainDoorUpdate", true).apply();
        }
        buildScreen();
        configureWebView();
        try {
            script = asset("booking-engine.js") + "\n" + asset("runner.js");
            entryScript = asset("entry-selector.js");
            loginScript = asset("login.js");
        }
        catch (Exception error) { showError("App files could not be loaded. Reinstall Gym Now."); return; }
        begin();
        handler.postDelayed(poll, 1000);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label); b.setTextSize(12); b.setAllCaps(false); b.setMinWidth(0); b.setMinimumWidth(0);
        b.setPadding(dp(4), 0, dp(4), 0);
        return b;
    }

    private void buildScreen() {
        getWindow().setStatusBarColor(DARK);
        getWindow().setNavigationBarColor(Color.WHITE);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE); root.setFitsSystemWindows(true);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        LinearLayout top = new LinearLayout(this); top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(16), dp(12), dp(16), dp(10)); top.setBackgroundColor(DARK);
        TextView title = new TextView(this); title.setText("Gym Now"); title.setTextSize(23);
        title.setTextColor(Color.WHITE); title.setTypeface(null, 1); top.addView(title);
        subtitle = new TextView(this); subtitle.setTextSize(12); subtitle.setTextColor(Color.rgb(200, 227, 217)); top.addView(subtitle);
        status = new TextView(this); status.setTextSize(14); status.setTextColor(Color.WHITE);
        status.setPadding(0, dp(8), 0, 0); top.addView(status); root.addView(top);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true); root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        LinearLayout controls = new LinearLayout(this); controls.setPadding(dp(4), 0, dp(4), 0);
        go = button("Book now"); gymButton = button("Gym"); accountButton = button("Account"); entryButton = button("Chrome");
        for (Button b : new Button[]{go, gymButton, accountButton, entryButton}) controls.addView(b, new LinearLayout.LayoutParams(0, dp(49), 1));
        root.addView(controls); web = new WebView(this); root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        go.setOnClickListener(v -> begin()); gymButton.setOnClickListener(v -> selectGym());
        accountButton.setOnClickListener(v -> accountMenu()); entryButton.setOnClickListener(v -> { if (!lastEntry.isEmpty()) openChrome(); });
        entryButton.setEnabled(false); updateSubtitle();
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true); settings.setSupportMultipleWindows(false);
        settings.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if ("gymnow".equals(uri.getScheme())) {
                    if (AppPolicy.officialPage(view.getUrl())) {
                        if ("login".equals(uri.getHost())) loginResult(uri);
                        else event(uri);
                    }
                    return true;
                }
                if (AppPolicy.officialNavigation(uri.toString())) return false;
                if (request.hasGesture() && "https".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                pageReady = false; pageGeneration++; doorCheckInFlight = false;
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true; CookieManager.getInstance().flush(); maybeLogin(); maybeRun(); maybeSelectDoor();
                if (isLoginPage(url) && !signingIn && !vault.hasLogin())
                    status.setText("Sign in below, or use Account → Save Ark login to remember your password.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    resetLogin(); wantRun = false; selectingDoor = false; setBusy(false);
                    status.setText("The Ark page could not load. Check your connection and tap Book now.");
                }
            }
        });
    }

    private String outlet() { return prefs.getString("outlet", ""); }
    private String gymName() {
        String selected = outlet();
        for (String[] pair : GYMS) if (pair[0].equals(selected)) return pair[1];
        return AppPolicy.validOutlet(selected) ? selected : "Choose gym";
    }
    private void updateSubtitle() { subtitle.setText(gymName() + " · Official sign-in: arkkies.com · Unofficial helper"); }
    private void setBusy(boolean value) {
        busy = value;
        go.setEnabled(!value && !signingIn && AppPolicy.validOutlet(outlet()));
        gymButton.setEnabled(!value && !signingIn);
        accountButton.setEnabled(!value && !signingIn);
        progress.setVisibility(value || wantRun || selectingDoor || signingIn ? View.VISIBLE : View.GONE);
    }
    private void begin() {
        if (busy || signingIn || loginDialogVisible || gymDialog != null || destroyed) return;
        automaticLoginTried = false;
        resumeBooking();
    }
    private void resumeBooking() {
        String url = AppPolicy.bookingStartUrl(outlet());
        if (url == null) {
            wantRun = false;
            setBusy(false);
            status.setText("Choose your gym before booking.");
            selectGym();
            return;
        }
        selectingDoor = false; entryStarted = 0;
        lastEntry = ""; entryButton.setEnabled(false); wantRun = true; pageReady = false;
        runToken = UUID.randomUUID().toString();
        status.setText("Opening Ark for " + gymName() + "…"); setBusy(false);
        web.loadUrl(url);
    }
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            maybeLogin(); maybeRun(); maybeSelectDoor();
            if (signingIn && System.currentTimeMillis() - loginStartedAt > 55000) {
                resetLogin(); wantRun = false; setBusy(false);
                status.setText("Sign-in timed out. Check your connection, then tap Book now to try again.");
            }
            // Interrupting a booking can leave an unknown result; never automatically retry it.
            if (busy && System.currentTimeMillis() - runStarted > 180000) {
                wantRun = false; setBusy(false); runToken = "";
                status.setText("This attempt took too long. Check Bookings in Ark before trying again.");
            }
            handler.postDelayed(this, 1000);
        }
    };
    private void maybeRun() {
        if (!wantRun || busy || signingIn || loginDialogVisible || gymDialog != null ||
                !pageReady || destroyed || !AppPolicy.validOutlet(outlet())) return;
        String url = web.getUrl();
        if (!AppPolicy.officialPage(url) || Uri.parse(url).getPath() == null || !Uri.parse(url).getPath().startsWith("/portal")) return;
        wantRun = false; runStarted = System.currentTimeMillis(); setBusy(true);
        try {
            JSONObject config = new JSONObject(); config.put("outlet", outlet()); config.put("gymName", gymName());
            config.put("passId", prefs.getString("passId", "")); config.put("token", runToken);
            if (vault.hasLogin()) {
                CredentialVault.Login saved = vault.read();
                if (saved != null) config.put("expectedIdentity", saved.identity);
            }
            String call = "(function(){const GYM_NOW_CONFIG=" + config.toString() + ";\n" + script + "\n})();";
            web.evaluateJavascript(call, null);
        } catch (Exception error) { setBusy(false); showError("The booking shortcut could not start."); }
    }
    private void maybeSelectDoor() {
        if (!selectingDoor || busy || wantRun || !pageReady || destroyed || doorCheckInFlight ||
                !AppPolicy.verifiedEntry(web.getUrl(), lastEntry)) return;
        if (entryStarted == 0) entryStarted = System.currentTimeMillis();
        if (System.currentTimeMillis() - entryStarted > 25000) {
            finishDoorSelection("Remote Entry is ready. Choose Main Door on the page if it is not selected.");
            return;
        }
        final String token = runToken, expectedEntry = lastEntry;
        final long generation = pageGeneration;
        try {
            JSONObject config = new JSONObject(); config.put("entryUrl", expectedEntry); config.put("token", token);
            doorCheckInFlight = true;
            web.evaluateJavascript("(function(){\n" + entryScript + "\nreturn selectArkMainDoor(" + config.toString() + ");})()", result -> {
                if (destroyed || generation != pageGeneration || !token.equals(runToken)) return;
                doorCheckInFlight = false;
                if (!selectingDoor || !AppPolicy.verifiedEntry(web.getUrl(), expectedEntry)) return;
                try {
                    Object parsed = new JSONTokener(result).nextValue();
                    if ("selected".equals(parsed)) finishDoorSelection("Main Door selected. Tap Unlock when you are at the door.");
                    else if ("ambiguous".equals(parsed) || "unavailable".equals(parsed)) {
                        finishDoorSelection("Remote Entry is ready. Choose the door on Ark’s page.");
                    }
                } catch (Exception ignored) {}
            });
        } catch (Exception error) {
            doorCheckInFlight = false;
            finishDoorSelection("Remote Entry is ready. Choose Main Door on Ark’s page.");
        }
    }
    private void finishDoorSelection(String message) {
        selectingDoor = false; setBusy(false); status.setText(message);
    }
    private void event(Uri uri) {
        if (!"event".equals(uri.getHost()) || !busy || !runToken.equals(uri.getQueryParameter("token"))) return;
        String kind = uri.getQueryParameter("type"), value = uri.getQueryParameter("value");
        if (value == null) value = "";
        if ("status".equals(kind)) { status.setText(value.substring(0, Math.min(240, value.length()))); }
        else if ("auth".equals(kind)) {
            wantRun = true; setBusy(false);
            status.setText("Sign in directly to Ark below. Booking continues after sign-in.");
            web.loadUrl("https://arkkies.com/login");
        } else if ("error".equals(kind)) { wantRun = false; setBusy(false); showError(value); }
        else if ("passes".equals(kind)) { choosePass(value); }
        else if ("done".equals(kind) && AppPolicy.validBookingId(value)) {
            wantRun = false; selectingDoor = true; entryStarted = 0;
            lastEntry = AppPolicy.entryUrl(value); entryButton.setEnabled(true); setBusy(false);
            status.setText("Booking verified. Opening Remote Entry and selecting Main Door…");
            web.loadUrl(lastEntry);
            if (prefs.getBoolean("chrome", false)) openChrome();
        }
    }
    private void choosePass(String json) {
        try {
            JSONArray array = new JSONArray(json); if (array.length() < 1 || array.length() > 30) throw new Exception();
            String[] labels = new String[array.length()];
            for (int i=0; i<labels.length; i++) labels[i] = array.getJSONObject(i).getString("name");
            new AlertDialog.Builder(this).setTitle("Use subscription for this booking")
                .setItems(labels, (d, selected) -> {
                    try {
                        String id = array.getJSONObject(selected).getString("id");
                        prefs.edit().putString("passId", id).apply();
                        JSONObject result = new JSONObject(); result.put("token", runToken); result.put("id", id);
                        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('gym-now-pass',{detail:" + result.toString() + "}));", null);
                    } catch (Exception error) { cancelChoice(); }
                }).setNegativeButton("Cancel", (d, w) -> cancelChoice()).setOnCancelListener(d -> cancelChoice()).show();
        } catch (Exception error) { wantRun = false; setBusy(false); showError("Subscription choices could not be loaded. Use the Ark portal."); }
    }
    private void cancelChoice() {
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('gym-now-pass',{detail:{token:" + JSONObject.quote(runToken) + ",id:null}}));", null);
    }
    private void openChrome() {
        if (lastEntry.isEmpty()) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(lastEntry)); intent.setPackage("com.android.chrome"); startActivity(intent);
        } catch (Exception error) { status.setText("Chrome is unavailable. Remote Entry remains open below."); }
    }
    private void selectGym() {
        if (busy || signingIn || loginDialogVisible || gymDialog != null || destroyed) return;
        String[] names = new String[GYMS.length + 1];
        for (int i=0; i<GYMS.length; i++) names[i] = GYMS[i][1]; names[GYMS.length] = "Another Ark outlet ID";
        showGymDialog(new AlertDialog.Builder(this).setTitle("Choose gym").setItems(names, (dialog, which) -> {
            if (which < GYMS.length) setGym(GYMS[which][0]);
            else {
                android.widget.EditText input = new android.widget.EditText(this); input.setSingleLine(true); input.setHint("e.g. AGRKHG01");
                showGymDialog(new AlertDialog.Builder(this).setTitle("Ark outlet ID").setView(input)
                    .setPositiveButton("Save", (d,w) -> {
                        String value = input.getText().toString().trim().toUpperCase(java.util.Locale.ROOT);
                        if (AppPolicy.validOutlet(value)) setGym(value); else showError("Enter a valid Ark outlet ID.");
                    }).setNegativeButton("Cancel", null).create());
            }
        }).create());
    }
    private void showGymDialog(AlertDialog dialog) {
        gymDialog = dialog;
        dialog.setOnDismissListener(d -> { if (gymDialog == dialog) gymDialog = null; });
        dialog.show();
    }
    private void setGym(String value) {
        if (wantRun || selectingDoor) {
            web.stopLoading();
            pageReady = false;
        }
        wantRun = false; selectingDoor = false; runToken = "";
        prefs.edit().putString("outlet", value).remove("passId").apply(); updateSubtitle();
        lastEntry = ""; entryButton.setEnabled(false);
        setBusy(false);
        status.setText("Gym set to " + gymName() + ". Tap Book now when ready.");
    }
    private boolean isLoginPage(String url) {
        return AppPolicy.officialPage(url) && "/login".equals(Uri.parse(url).getPath());
    }
    private void resetLogin() {
        signingIn = false; loginStarted = false; loginToken = "";
        loginIdentifier = ""; loginPassword = ""; expectedIdentity = ""; manualLogin = false;
    }
    private void startLogin(String identifier, String password, String identity, boolean manual) {
        runToken = ""; wantRun = false; selectingDoor = false; lastEntry = ""; entryButton.setEnabled(false);
        automaticLoginTried = true; manualLogin = manual; signingIn = true; loginStarted = false;
        loginIdentifier = identifier; loginPassword = password; expectedIdentity = identity;
        loginToken = UUID.randomUUID().toString(); loginStartedAt = System.currentTimeMillis();
        pageReady = false; setBusy(false); status.setText(manual ? "Verifying your Ark login…" : "Signing you back in to Ark…");
        web.loadUrl("https://arkkies.com/login");
    }
    private void maybeLogin() {
        if (destroyed || !pageReady || loginDialogVisible || gymDialog != null || !isLoginPage(web.getUrl())) return;
        if (!signingIn) {
            if ((!wantRun && !selectingDoor) || busy || automaticLoginTried || !vault.hasLogin()) return;
            automaticLoginTried = true;
            try {
                CredentialVault.Login saved = vault.read();
                if (saved != null) startLogin(saved.identifier, saved.password, saved.identity, false);
            } catch (Exception error) {
                wantRun = false; setBusy(false);
                status.setText("Saved login could not be unlocked. Use Account → Save Ark login to enter it again.");
            }
            return;
        }
        if (loginStarted) return;
        loginStarted = true;
        try {
            JSONObject config = new JSONObject(); config.put("identifier", loginIdentifier);
            config.put("password", loginPassword); config.put("expectedIdentity", expectedIdentity);
            String prefix = "gymnow://login?token=" + Uri.encode(loginToken);
            web.evaluateJavascript("(function(){\n" + loginScript + "\nconst configuration=" + config.toString() + ";" +
                "signInArk(configuration).then(function(result){location.href=" + JSONObject.quote(prefix) +
                "+'&type='+encodeURIComponent(result.type)+'&identity='+encodeURIComponent(result.identity||'');});})();", null);
            // Automatic attempts do not need to retain the plaintext in native state.
            if (!manualLogin) loginPassword = "";
        } catch (Exception error) {
            resetLogin(); wantRun = false; setBusy(false); status.setText("Automatic sign-in could not start. Use the Ark login below.");
        }
    }
    private void loginResult(Uri uri) {
        if (!signingIn || !isLoginPage(web.getUrl()) || !loginToken.equals(uri.getQueryParameter("token"))) return;
        String type = uri.getQueryParameter("type"), identity = uri.getQueryParameter("identity");
        if ("success".equals(type) && !manualLogin && !expectedIdentity.equals(identity)) type = "mismatch";
        if ("success".equals(type) && identity != null && !identity.isEmpty() && identity.length() <= 256) {
            boolean saved = true;
            if (manualLogin) {
                try {
                    vault.save(new CredentialVault.Login(loginIdentifier, loginPassword, identity));
                    prefs.edit().remove("passId").apply();
                } catch (Exception error) { saved = false; }
            }
            resetLogin(); CookieManager.getInstance().flush();
            if (!saved) {
                wantRun = false; setBusy(false);
                status.setText("Signed in, but your phone could not save the password. Use Account → Save Ark login to try again, or tap Book now.");
            } else resumeBooking();
        } else {
            resetLogin(); wantRun = false; setBusy(false);
            if ("invalid".equals(type)) status.setText("Ark did not accept the login. Use Account → Save Ark login to update it. No automatic retry was made.");
            else if ("limited".equals(type)) status.setText("Ark has limited sign-in attempts. Wait before trying again.");
            else if ("network".equals(type)) status.setText("Sign-in could not connect. Check your connection, then tap Book now.");
            else if ("mismatch".equals(type)) status.setText("Ark returned a different account. Use Account → Switch Ark account before continuing.");
            else status.setText("Ark needs the website login below. Automatic sign-in has stopped; tap Book now after signing in.");
        }
    }
    private void showSavedLoginDialog(String identifier) {
        if (loginDialogVisible || busy || signingIn) return;
        loginDialogVisible = true;
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(8), dp(22), dp(8));
        TextView explanation = new TextView(this);
        explanation.setText("Enter your Ark login once. After Ark verifies it, Gym Now encrypts it on this phone and signs you back in when needed.");
        form.addView(explanation);
        EditText email = new EditText(this); email.setSingleLine(true); email.setHint("Ark email address");
        email.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        email.setText(identifier); email.setSaveEnabled(false); form.addView(email);
        EditText password = new EditText(this); password.setSingleLine(true); password.setHint("Ark password");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setSaveEnabled(false); form.addView(password);
        TextView error = new TextView(this); error.setTextColor(Color.rgb(160, 35, 35)); form.addView(error);
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Remember Ark login")
            .setView(scroll).setPositiveButton("Save & sign in", null)
            .setNegativeButton("Cancel", null).create();
        dialog.setOnDismissListener(d -> { password.setText(""); loginDialogVisible = false; });
        dialog.setOnShowListener(d -> {
            dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String id = email.getText().toString().trim(), secret = password.getText().toString();
                if (id.isEmpty() || secret.isEmpty()) { error.setText("Enter your email address and password."); return; }
                if (id.length() > 320 || secret.length() > 4096) { error.setText("Check your login details."); return; }
                dialog.dismiss(); startLogin(id, secret, "", true);
            });
        });
        dialog.show();
    }
    private void accountMenu() {
        String destination = prefs.getBoolean("chrome", false) ? "Keep entry inside Gym Now (auto Main Door)" : "Open entry in Chrome (choose door there)";
        new AlertDialog.Builder(this).setTitle("Account & entry").setItems(new String[]{"Save Ark login / change password", "Forget saved password", "Switch Ark account / sign out", "Choose subscription again", destination, "About & privacy"}, (dialog, which) -> {
            if (which == 0) {
                String identifier = "";
                try { CredentialVault.Login login = vault.read(); if (login != null) identifier = login.identifier; } catch (Exception ignored) {}
                showSavedLoginDialog(identifier);
            } else if (which == 1) {
                new AlertDialog.Builder(this).setTitle("Forget saved password?")
                    .setMessage("Automatic sign-in will stop. Your current Ark session stays signed in until it expires.")
                    .setPositiveButton("Forget", (d,w) -> {
                        try { vault.clear(); status.setText("Saved password removed from this phone."); }
                        catch (Exception error) { status.setText("Saved password could not be fully removed. Clear Gym Now’s app storage in Android Settings."); }
                    }).setNegativeButton("Cancel", null).show();
            } else if (which == 2) new AlertDialog.Builder(this).setTitle("Sign out and forget login?")
                .setMessage("This removes the saved password and Ark sign-in from Gym Now on this phone.")
                .setPositiveButton("Sign out", (d,w) -> signOut()).setNegativeButton("Cancel", null).show();
            else if (which == 3) { prefs.edit().remove("passId").apply(); status.setText("You can choose a subscription on the next new booking."); }
            else if (which == 4) {
                boolean chrome = !prefs.getBoolean("chrome", false); prefs.edit().putBoolean("chrome", chrome).apply();
                status.setText(chrome ? "Chrome entry needs its own sign-in and door choice. Automatic Main Door selection stays inside Gym Now." : "Entry stays in Gym Now and Main Door is selected automatically.");
            } else new AlertDialog.Builder(this).setTitle("Gym Now · 0.3.3 · unofficial")
                .setMessage("Saved login is optional. Your email and password are encrypted on this phone with an Android Keystore key after Ark verifies them. Login requests go directly to api.arkkies.com over HTTPS. No helper server, analytics or cloud credential backup is used. Account lets you forget the password or sign out. Existing Ark sessions are reused; an expired session gets one automatic login attempt per launch. Main Door selection and booking stay as before. Unlock remains on Ark’s page.")
                .setPositiveButton("OK", null).show();
        }).show();
    }
    private void signOut() {
        try { vault.clear(); }
        catch (Exception error) { showError("Saved login could not be removed. Clear Gym Now’s app storage in Android Settings before switching accounts."); return; }
        resetLogin(); runToken = ""; wantRun = false; selectingDoor = false; automaticLoginTried = true;
        prefs.edit().remove("passId").apply(); lastEntry = ""; entryButton.setEnabled(false); setBusy(false);
        web.stopLoading(); pageReady = false;
        CookieManager.getInstance().removeAllCookies(cleared -> {
            if (destroyed) return;
            CookieManager.getInstance().flush(); WebStorage.getInstance().deleteAllData();
            web.clearCache(true); web.clearFormData(); web.clearHistory();
            status.setText("Signed out. Use Account → Save Ark login for the next account, or sign in below.");
            web.loadUrl("https://arkkies.com/login");
        });
    }
    private void showError(String value) {
        status.setText(value == null || value.isEmpty() ? "Check the official Ark page below." : value);
    }
    private String asset(String name) throws Exception {
        try (InputStream input = getAssets().open(name); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n;
            while ((n = input.read(buffer)) != -1) output.write(buffer,0,n);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); begin(); }
    @Override public void onBackPressed() {
        if (signingIn) {
            resetLogin(); web.stopLoading(); wantRun = false; setBusy(false); status.setText("Sign-in cancelled. Tap Book now when ready.");
        } else if (web.canGoBack() && !busy) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() {
        destroyed = true; resetLogin(); handler.removeCallbacksAndMessages(null);
        if (gymDialog != null) gymDialog.dismiss();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
