# Gym Now for Android

![Gym Now launcher icon](./res/mipmap-xxxhdpi/ic_gym_now.png)

An unofficial Ark Grit gym booking helper for Android 8.0 or later and a current
Android System WebView.

## Get the app

[**Download Gym Now v0.3.2 for Android**](downloads/Gym_Now_v0_3_2.apk?raw=true)

This APK supports fresh installs and updates from the v0.3.0 release. The
v0.3.1 APK used a different signing key, so Android will block an in-place
update from that version.

To build a local APK, follow [Build from source](#build-from-source).

## Use the v0.3.2 download

![Three-panel Gym Now tutorial showing sign-in, gym selection, and Book now](./docs/gym-now-quick-start.png)

[Open the tutorial image](./docs/gym-now-quick-start.png)

1. Open Gym Now and sign in with your own Ark account. Choose **Use website** to
   sign in through Ark’s page, or **Save & sign in** to remember your login on
   this phone after Ark verifies it.
2. Use **Gym** to choose the branch you want. Version 0.3.2 starts with Keat Hong
   selected and can resume booking after sign-in or when the app opens.
3. Tap **Book now** to use an existing booking or book the current slot under an
   eligible subscription. Gym Now then opens Ark’s entry page when available.
   Press **Unlock** on Ark’s page when you reach the door.

To opt in or change your saved login later, choose
**Account → Save Ark login / change password**.

- **Account → Forget saved password:** deletes the saved credential and its
  encryption key; the current website session remains signed in until expiry.
- **Account → Switch Ark account / sign out:** deletes saved credentials,
  app cookies, site storage and the remembered subscription. The next account
  can use Save Ark login or sign in on the website.
- **Gym:** choose another branch before making a booking there.
- **Chrome:** optional external Remote Entry. Chrome uses a separate sign-in;
  saved passwords and automatic Main Door selection apply inside Gym Now.

## What changed in v0.3.3

The source builds v0.3.3. The signed download above is v0.3.2.

- Choose your gym on first launch. The app waits for a selection before starting a booking.
- Tap **Book now** to open Ark’s website for sign-in. **Account → Save Ark login**
  is available if you choose to save your login on this phone.
- Your gym stays selected for later launches. The booking shortcut checks for a
  current booking before creating one.

## Saved-password behavior

The optional saved-login form saves only after successful authentication. Requests
follow Ark's ordinary browser login protocol: obtain a fresh login flow and
CSRF token, submit the password to the exact official HTTPS login endpoint,
then confirm `/sessions/whoami`. Both the current `identifier` field returned
by Ark's flow and the older `password_identifier` field are supported.

A failed sign-in gets no automatic retry in the same launch. Wrong passwords,
rate limiting, unfamiliar flows and additional verification stop automation.
Update the password through Account, or complete the official website login
and tap Book now. A fresh app launch or explicit Book now starts a new attempt.
If the saved credential cannot be decrypted, enter it again through Account.

The saved account is checked against the returned Ark identity. Booking also
checks that an existing session belongs to the saved account before doing any
booking work. Switching accounts removes the previous credential and pass.

## Credential storage and privacy

The email, password and verified Ark account ID are encrypted together with
AES-256-GCM, using a fresh random IV per save and authenticated app-specific
context. The encryption key is generated in Android Keystore and is
non-exportable through the app APIs. Hardware protection depends on the phone.
Only ciphertext is written to the app's private preferences. There is no
plaintext credential fallback. Removing a saved login deletes both its record
and key. Android app backup is disabled; a key unavailable after reinstall or
transfer requires entering the credential again.

The key does not require a biometric prompt on each use, enabling automatic
login while the user has the app open. Protect access to the phone with its
screen lock. Password fields are masked, not saved in UI instance state, and
the app and login dialog prevent ordinary Android screenshots/recents previews.
Java/JavaScript plaintext references are released after the login operation;
managed runtimes do not guarantee immediate erasure of immutable strings.

Credentials are sent only in HTTPS request bodies directly to
**api.arkkies.com**. They are not sent to a helper backend, included in URLs,
written to web storage, logged, or exported in the source archive. WebView
remote debugging is disabled. There is no analytics or server account store.
The only declared permission is Internet access. No accessibility/macro setup,
contacts, location, notification or additional NFC permission is needed for
an existing NFC task that launches this app.

## Booking and entry behavior

The existing subscription/booking engine and Main Door helper are retained.
They check the current session, retrieve existing bookings first, select a
covered active gym subscription and the slot containing now, recheck for an
existing booking, submit at most one booking request, and verify the result.
Pending markers are scoped to the authenticated account and slot. An uncertain
booking result is not automatically reposted, including after sign-in renewal.
No membership purchases are made. Door unlocking stays on Ark's page.

## Validation and limits

The current public Ark client and unauthenticated login-flow response were
inspected on 5 November 2026. The latter returned a POST login action, CSRF
field, identifier field and password field; no CAPTCHA appeared in that flow.

The bundled tests cover booking, login, navigation rules, and encryption.
Browser-only door tests are available in the source and use local fixtures
with Chromium.

**This build has not been installed on a physical Android phone or tested with
a successful real Ark account login.** Offline tests and a public login-flow
inspection cannot prove live phone behavior. No real user password was used,
no real gym booking was created and no door was unlocked during development.
Ark may require additional verification or change its login protocol later.

## Build from source

Requirements: Linux x86-64, Java/JDK 17+, Python 3 and Node.js.

Run `python3 build.py`. It downloads pinned Android platform/build tools from
Google, verifies their checksums, runs tests and produces the signed APK. Set
`GYM_NOW_TOOLCHAIN` to reuse an existing verified tool directory. No Gradle or
bundled third-party runtime is required. Run `python3 build.py --unsigned` to build an aligned APK for release signing.

The shared source archive contains no private signing key. Building it without
the original private `.signing` directory generates a new local signing key,
which Android treats as a different signer when installing an update. Use the
original app signing key to install over an existing Gym Now release.

Optional browser tests: install Playwright and Chromium, then run
`node --test tests/entry-selector.test.js`. All browser fixtures intercept
requests locally and do not contact Ark.

Public references:
- https://arkkies.com/portal/home
- https://arkkies.com/app.bundle.js
- https://developer.android.com/privacy-and-security/keystore
- https://developer.android.com/reference/android/webkit/WebView


## License

Gym Now’s source code is available under the [MIT License](LICENSE). The
launcher artwork in `res/`, which incorporates the Ark Grit mark, is excluded
from that license.
