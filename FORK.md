# bemodi fork of Uptime Kuma

This fork of [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) (3.0 beta) adds:

1. **Multiple users without roles.** Every user is an admin and sees and manages the same monitors, notifications, status pages and settings. There are no personal notification channels.
2. **Login with a passkey only.** Each account has at least 1 and at most 3 passkeys. A passkey has to verify the user (PIN or biometrics), so it is multi-factor on its own.
3. **Audit log** of all changes and login events under **Settings › Audit Log**, with filters and CSV export.

Branches: `master` mirrors upstream, `bemodi` is the default branch with the fork's changes.

## How login works

| Situation                       | What happens                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal login                    | "Log in with passkey". No username is needed, the browser offers the stored passkeys.                                                                                                                                      |
| First login of a new user       | An admin creates the user under **Settings › Users** and gets a start password, shown once. The user logs in with it ("Log in with password") and has to set up a passkey before anything else.                            |
| Account has a passkey           | The password login is rejected. The password stays part of the account (e.g. for "Change Password"), but it no longer logs anyone in.                                                                                      |
| Passkey lost                    | Another admin uses **Reset Access** on the user. This removes all passkeys, generates a new password and ends all sessions. The user logs in with the new password and sets up a new passkey.                              |
| The only user lost all passkeys | Run `npm run reset-passkeys` in the container (see below).                                                                                                                                                                 |
| User leaves                     | **Deactivate** ends all sessions and blocks login, while keeping the user's name in the history and their API keys. **Delete** also deletes the user's API keys. Nobody can reset, deactivate or delete their own account. |

Passkeys are managed under **Settings › Security › Passkeys**: add (up to 3), rename, delete (never the last one).

## Configuration

| Variable                          | Required           | Meaning                                                                                                                                                                        |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UPTIME_KUMA_PASSKEY_ORIGIN`      | yes, in production | Public URL of the instance, e.g. `https://status.example.com`. Passkeys only work on this address.                                                                             |
| `UPTIME_KUMA_PASSKEY_RP_ID`       | no                 | Relying party ID, defaults to the hostname of `UPTIME_KUMA_PASSKEY_ORIGIN`. Set it to a parent domain (e.g. `example.com`) only if passkeys should work on several subdomains. |
| `UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS` | no                 | Days to keep audit entries, default `365`. `0` keeps them forever.                                                                                                             |

Notes:

- Passkeys need HTTPS (or `http://localhost`). Access via an IP address does not work.
- Changing the domain or the RP ID later makes all existing passkeys useless. Then every user needs **Reset Access**, and the last admin needs `reset-passkeys`.
- Without `UPTIME_KUMA_PASSKEY_ORIGIN`, the server logs a warning and passkeys only work on `http://localhost`.

## Audit log

Every state-changing action of a logged-in user and every login event is recorded: time, user, IP, action, object and result. Failed actions and failed logins are included.

- **Changes** are socket events such as `add`, `editMonitor`, `deleteNotification`, `setSettings`, `addUser` or `resetUserAccess`. Reads are not recorded. Events that are not explicitly marked as reads are recorded, so features added upstream are covered without extra work.
- **Login events** cover password and passkey login (`login:password`, `login:passkey`), the TOTP step, logout, changing the password, and adding, renaming or deleting a passkey.
- **No secrets.** Arguments are stored through an allowlist (IDs, names, types, slugs). Passwords, tokens and URLs with credentials are not stored.
- **Read only.** The UI cannot edit or delete entries. Entries older than `UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS` (default `365`, `0` keeps everything) are removed by the daily cleanup.
- **SIEM.** Each entry is also logged to stdout as a JSON line with the tag `[AUDIT]`, so container logs can be shipped to a log system.
- **Client IP.** The IP honours **Settings › Reverse Proxy › Trust Proxy**. Behind a reverse proxy, switch it on, otherwise every entry shows the proxy's IP.

## Removed upstream features

- **Disable Auth** is gone. It would bypass the passkey. Instances that had it switched on get it switched off by a migration.
- **`/metrics` with username and password** is gone. Use an API key (Settings › API Keys) as the Basic Auth password.

TOTP two-factor authentication still exists from upstream, but it only affects the password step, which is used for first login and recovery.

## Emergency recovery in the container

```bash
# Remove all passkeys of a user and end their sessions
docker exec -it <container> npm run reset-passkeys

# If the password is lost too
docker exec -it <container> npm run reset-password
```

Then log in with "Log in with password" and set up a new passkey.

## Upgrading from upstream Uptime Kuma

Point the fork's image at the existing data directory. The existing user logs in once with their password and sets up a passkey. Further users are added under Settings › Users.
