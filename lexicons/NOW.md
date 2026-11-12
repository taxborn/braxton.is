# is.braxton.now

A status update, written to follow the handle. The record `{"status": "working on
this website"}` reads as "braxton.is working on this website". The convention
comes from [now.dame.is](https://bsky.app/profile/now.dame.is).

Each status goes to two places:

| Record                                           | Repo             | Read by            |
| ------------------------------------------------ | ---------------- | ------------------ |
| `is.braxton.now` ([schema](is.braxton.now.json)) | `braxton.is`     | this site's header |
| `app.bsky.feed.post`                             | `now.braxton.is` | Bluesky            |

An Apple Shortcut writes both straight to the PDS with an app password. No server
sits in between.

## How the site reads it

`src/lib/now.ts` asks the PDS for the newest `is.braxton.now` record
(`com.atproto.repo.listRecords` with `limit=1`) and
`src/components/NowStatus.astro` renders it in the header. The server caches the
answer for 60 seconds, so a new status appears within a minute. With no records,
the header shows only the site name.

The site never reads the `now.braxton.is` account. That account exists so the
statuses show up in Bluesky.

The schema is not published to the network (there is no `_lexicon` DNS record),
so the PDS stores these records without validating them.

## The now.braxton.is account

The account is `did:plc:tbwqjtxcplbmvlbadh3m5i5o`, on the same PDS as the main
account. To check that the handle still resolves to it:

```sh
curl 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=now.braxton.is'
```

## Build the Shortcut

Create an app password on each account first (Settings → Privacy and security →
App passwords). Name them after the Shortcut so you know which to revoke.

Values used below:

|            | Main account              | Now account               |
| ---------- | ------------------------- | ------------------------- |
| PDS host   | `https://pds.biscuits.at` | `https://pds.biscuits.at` |
| Identifier | `braxton.is`              | `now.braxton.is`          |
| Password   | its app password          | its app password          |

Add these actions in order.

1. **Ask for Input.** Type Text, prompt `braxton.is…`. Then **Set Variable**
   `Status`.
2. **Date** (Current Date), then **Format Date** with Date Format "ISO 8601" and
   "Include ISO 8601 Time" turned on. Then **Set Variable** `Now`. The result
   looks like `2026-11-11T10:01:02-06:00`.
3. **Get Contents of URL** to sign in to the main account.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.server.createSession`
   - Method: POST
   - Request Body: JSON, with two Text fields. `identifier` is `braxton.is` and
     `password` is the main account's app password.
4. **Get Dictionary Value** for the key `accessJwt`. Then **Set Variable**
   `MainToken`.
5. **Get Contents of URL** to write the status record.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.repo.createRecord`
   - Method: POST
   - Headers: `Authorization` set to `Bearer ` followed by the `MainToken`
     variable
   - Request Body: JSON, with these fields

     | Key          | Type       | Value            |
     | ------------ | ---------- | ---------------- |
     | `repo`       | Text       | `braxton.is`     |
     | `collection` | Text       | `is.braxton.now` |
     | `record`     | Dictionary | see below        |

     Inside `record`:

     | Key         | Type | Value                 |
     | ----------- | ---- | --------------------- |
     | `$type`     | Text | `is.braxton.now`      |
     | `status`    | Text | the `Status` variable |
     | `createdAt` | Text | the `Now` variable    |

6. Repeat steps 3 and 4 for the now account. The URL is the same, `identifier`
   is `now.braxton.is` and `password` is that account's app password. Name the
   variable `NowToken`.
7. **Get Contents of URL** to write the Bluesky post.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.repo.createRecord`
   - Method: POST
   - Headers: `Authorization` set to `Bearer ` followed by the `NowToken`
     variable
   - Request Body: JSON, with these fields

     | Key          | Type       | Value                |
     | ------------ | ---------- | -------------------- |
     | `repo`       | Text       | `now.braxton.is`     |
     | `collection` | Text       | `app.bsky.feed.post` |
     | `record`     | Dictionary | see below            |

     Inside `record`:

     | Key         | Type  | Value                 |
     | ----------- | ----- | --------------------- |
     | `$type`     | Text  | `app.bsky.feed.post`  |
     | `text`      | Text  | the `Status` variable |
     | `createdAt` | Text  | the `Now` variable    |
     | `langs`     | Array | one Text item, `en`   |

8. **Get Dictionary Value** for the key `uri` from step 7's result. Add an
   **If** on that value. If it has any value, **Show Notification** with
   `braxton.is` and the `Status` variable. Otherwise, **Show Result** with step
   7's result.

Build the `record` field as a Dictionary, not as a Text block of JSON. The
Dictionary escapes quotes and newlines in the status. A Text template breaks on
the first `"` you type.

## When it fails

Shortcuts does not stop on an HTTP error. A failed request returns a JSON body
with `error` and `message` keys, and the next action runs anyway. Step 8 catches
a failure in the last request. To debug an earlier one, add a **Show Result**
after it.

- `AuthenticationRequired` or `InvalidToken` on a write means the sign-in before
  it failed. Check the identifier, the app password and the PDS host.
- `InvalidRequest` naming `createdAt` means step 2 produced a date without a
  time. Turn on "Include ISO 8601 Time".
- If the PDS rejects `is.braxton.now` with a lexicon error, add a Boolean field
  `validate` set to false beside `repo` and `collection` in step 5.

The Shortcut holds both app passwords in plain text. Remove them before sharing
it. The main account's app password can write any record in the `braxton.is`
repo, so revoke it if you lose the phone.

## Check a status by hand

```sh
curl 'https://pds.biscuits.at/xrpc/com.atproto.repo.listRecords?repo=braxton.is&collection=is.braxton.now&limit=1'
```
