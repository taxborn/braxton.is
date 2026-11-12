# is.braxton.now

A status update, written to follow the handle. The record `{"status": "working on
this website"}` reads as "braxton.is working on this website". The convention
comes from [now.dame.is](https://bsky.app/profile/now.dame.is).

Each status writes three records:

| Record                                               | Repo             | Read by            |
| ---------------------------------------------------- | ---------------- | ------------------ |
| `is.braxton.state` ([schema](is.braxton.state.json)) | `braxton.is`     | this site's header |
| `is.braxton.now` ([schema](is.braxton.now.json))     | `braxton.is`     | this site's header |
| `app.bsky.feed.post`                                 | `now.braxton.is` | Bluesky            |

The state record is a reading of heart rate, activity and phone battery taken as
the status is posted. The now record points at it through `stateRef`, a
`com.atproto.repo.strongRef`. See [STATE.md](STATE.md).

An Apple Shortcut writes all three straight to the PDS with an app password. No
server sits in between.

## How the site reads it

`src/lib/now.ts` asks the PDS for the newest `is.braxton.now` record
(`com.atproto.repo.listRecords` with `limit=1`), then fetches the state record
its `stateRef` names. `src/components/NowStatus.astro` renders both in the
header, as the status, then the reading, then how long ago. The server caches
the status for 60 seconds, so a new one appears within a minute. With no
records, the header shows only the site name. A status with no `stateRef`, or
one that points at a missing record, shows without a reading.

The site never reads the `now.braxton.is` account. That account exists so the
statuses show up in Bluesky.

Until the schemas are published (see "Lexicons" in the README), the PDS stores
these records without validating them.

## The now.braxton.is account

The account is `did:plc:tbwqjtxcplbmvlbadh3m5i5o`, on the same PDS as the main
account. To check that the handle still resolves to it:

```sh
curl 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=now.braxton.is'
```

## Build the Shortcut

Build the "Log state" Shortcut from [STATE.md](STATE.md) first. This one calls
it.

Create an app password on each account (Settings → Privacy and security → App
passwords). Name them after the Shortcut so you know which to revoke.

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
3. **Run Shortcut** "Log state". From its result, **Get Dictionary Value** for
   the key `uri` and **Set Variable** `StateUri`. Then **Get Dictionary Value**
   for the key `cid` from the same result and **Set Variable** `StateCid`.
4. **Get Contents of URL** to sign in to the main account.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.server.createSession`
   - Method: POST
   - Request Body: JSON, with two Text fields. `identifier` is `braxton.is` and
     `password` is the main account's app password.
5. **Get Dictionary Value** for the key `accessJwt` from step 4's result. Then
   **Set Variable** `MainToken`. Add a second **Get Dictionary Value** for the
   key `did`, also from step 4's result, and **Set Variable** `MainDid`.
6. **Get Contents of URL** to write the status record.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.repo.createRecord`
   - Method: POST
   - Headers: `Authorization` set to `Bearer ` followed by the `MainToken`
     variable
   - Request Body: JSON, with these fields

     | Key          | Type       | Value                  |
     | ------------ | ---------- | ---------------------- |
     | `repo`       | Text       | the `MainDid` variable |
     | `collection` | Text       | `is.braxton.now`       |
     | `record`     | Dictionary | see below              |

     Inside `record`:

     | Key         | Type       | Value                 |
     | ----------- | ---------- | --------------------- |
     | `$type`     | Text       | `is.braxton.now`      |
     | `status`    | Text       | the `Status` variable |
     | `createdAt` | Text       | the `Now` variable    |
     | `stateRef`  | Dictionary | see below             |

     Inside `stateRef`:

     | Key   | Type | Value                   |
     | ----- | ---- | ----------------------- |
     | `uri` | Text | the `StateUri` variable |
     | `cid` | Text | the `StateCid` variable |

7. Repeat steps 4 and 5 for the now account. The URL is the same, `identifier`
   is `now.braxton.is` and `password` is that account's app password. Name the
   variables `NowToken` and `NowDid`.
8. **Get Contents of URL** to write the Bluesky post.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.repo.createRecord`
   - Method: POST
   - Headers: `Authorization` set to `Bearer ` followed by the `NowToken`
     variable
   - Request Body: JSON, with these fields

     | Key          | Type       | Value                 |
     | ------------ | ---------- | --------------------- |
     | `repo`       | Text       | the `NowDid` variable |
     | `collection` | Text       | `app.bsky.feed.post`  |
     | `record`     | Dictionary | see below             |

     Inside `record`:

     | Key         | Type  | Value                 |
     | ----------- | ----- | --------------------- |
     | `$type`     | Text  | `app.bsky.feed.post`  |
     | `text`      | Text  | the `Status` variable |
     | `createdAt` | Text  | the `Now` variable    |
     | `langs`     | Array | one Text item, `en`   |

9. **Get Dictionary Value** for the key `uri` from step 8's result. Add an
   **If** on that value. If it has any value, **Show Notification** with
   `braxton.is` and the `Status` variable. Otherwise, **Show Result** with step
   8's result.

Build the `record` field as a Dictionary, not as a Text block of JSON. The
Dictionary escapes quotes and newlines in the status. A Text template breaks on
the first `"` you type.

## When it fails

Shortcuts does not stop on an HTTP error. A failed request returns a JSON body
with `error` and `message` keys, and the next action runs anyway. Step 9 catches
a failure in the last request. To debug an earlier one, add a **Show Result**
after it.

- "The network connection was lost" or "cannot parse response" means the server
  dropped the request without answering. It does that when a header name is
  malformed. Check the step's Headers. The key must be exactly `Authorization`,
  with no space, colon or line break, and there must be no blank extra rows.
- `AuthenticationRequired` or `InvalidToken` on a write means the sign-in before
  it failed. Check the identifier, the app password and the PDS host.
- `InvalidRepo`, "Repo does not match authenticated user", means `repo` is not
  the DID of the account that signed in. Check that each write uses the token
  and the DID from the same sign-in.
- "invalid AT identifier" means `repo` holds typed text that is not a clean DID.
  Use the `did` value from the sign-in result.
- `InvalidRequest` naming `createdAt` means step 2 produced a date without a
  time. Turn on "Include ISO 8601 Time".
- If the PDS rejects `is.braxton.now` with a lexicon error, add a Boolean field
  `validate` set to false beside `repo` and `collection` in step 6.
- A status that shows on the site without a reading means "Log state" failed and
  left `StateUri` empty. Run "Log state" by itself to see its error.

The Shortcut holds both app passwords in plain text. Remove them before sharing
it. The main account's app password can write any record in the `braxton.is`
repo, so revoke it if you lose the phone.

## Check a status by hand

```sh
curl 'https://pds.biscuits.at/xrpc/com.atproto.repo.listRecords?repo=braxton.is&collection=is.braxton.now&limit=1'
```
