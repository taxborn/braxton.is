# is.braxton.state

One reading of my physical state, taken by an iPhone and Apple Watch. The
[schema](is.braxton.state.json) has three readings and a timestamp:

| Field          | Type     | Source in Shortcuts                           |
| -------------- | -------- | --------------------------------------------- |
| `heartRate`    | integer  | the newest Heart Rate sample in Health        |
| `activity`     | string   | Get Physical Activity, lowercased             |
| `batteryLevel` | integer  | Get Battery Level                             |
| `createdAt`    | datetime | Current Date, formatted as ISO 8601 with time |

The collection is an append-only log in the `braxton.is` repo. Records are
written two ways:

- An hourly automation writes one reading.
- The status Shortcut in [NOW.md](NOW.md) writes one reading and links it from
  the `is.braxton.now` record through `stateRef`.

## What the site shows

The header shows a reading only when the newest status links to one. It renders
as `working on this website ♥ 68 bpm walking 81% 5m ago`.

Nothing on the site reads the hourly records yet. They accumulate in the repo
for a later history view.

`parseState` in `src/lib/now.ts` drops a field that is missing or out of range
and keeps the others. It reads a heart rate of 0 as no reading, and hides an
activity of `unknown`.

## Build the "Log state" Shortcut

Both the hourly automation and the status Shortcut run this one. It needs iOS
17.4 or later for Get Physical Activity. The first run asks for permission to
read Health data.

1. **Find Health Samples** where Type is Heart Rate. Sort by Start Date, Latest
   First, and limit to 1.
2. **Get Details of Health Sample** for Value, then **Round Number** to the Ones
   Place. Then **Set Variable** `HeartRate`.
3. **Get Physical Activity**, then **Change Case** to lowercase. Then **Set
   Variable** `Activity`.
4. **Get Battery Level**, then **Round Number** to the Ones Place. Then **Set
   Variable** `Battery`.
5. **Date** (Current Date), then **Format Date** with Date Format "ISO 8601" and
   "Include ISO 8601 Time" turned on. Then **Set Variable** `Now`.
6. **Get Contents of URL** to sign in.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.server.createSession`
   - Method: POST
   - Request Body: JSON, with two Text fields. `identifier` is `braxton.is` and
     `password` is the main account's app password.
7. **Get Dictionary Value** for the key `accessJwt` from step 6's result. Then
   **Set Variable** `Token`. Add a second **Get Dictionary Value** for the key
   `did`, also from step 6's result, and **Set Variable** `Did`.
8. **Get Contents of URL** to write the reading.
   - URL: `https://pds.biscuits.at/xrpc/com.atproto.repo.createRecord`
   - Method: POST
   - Headers: `Authorization` set to `Bearer ` followed by the `Token` variable
   - Request Body: JSON, with these fields

     | Key          | Type       | Value              |
     | ------------ | ---------- | ------------------ |
     | `repo`       | Text       | the `Did` variable |
     | `collection` | Text       | `is.braxton.state` |
     | `record`     | Dictionary | see below          |

     Inside `record`:

     | Key            | Type   | Value                    |
     | -------------- | ------ | ------------------------ |
     | `$type`        | Text   | `is.braxton.state`       |
     | `heartRate`    | Number | the `HeartRate` variable |
     | `activity`     | Text   | the `Activity` variable  |
     | `batteryLevel` | Number | the `Battery` variable   |
     | `createdAt`    | Text   | the `Now` variable       |

9. **Stop and Output** the result of step 8. The status Shortcut reads `uri`
   and `cid` from it.

`repo` takes the `Did` variable, not typed text. This PDS rejects the handle
`braxton.is` there with `InvalidRepo`, "Repo does not match authenticated user".
It rejects a hand-entered DID with "invalid AT identifier" if the text picked up
a capital letter, a space or a line break on the way in.

Keep both Round Number actions. An atproto record cannot hold a decimal number,
so the PDS rejects `68.4`.

Run it once by hand and check the record:

```sh
curl 'https://pds.biscuits.at/xrpc/com.atproto.repo.listRecords?repo=braxton.is&collection=is.braxton.state&limit=1'
```

`heartRate` and `batteryLevel` should appear as bare numbers, like `68`, not as
`"68"` in quotes. The site reads either form, but the schema says integer.

## Run it hourly

Shortcuts has no hourly repeat. A Time of Day automation repeats daily, weekly
or monthly, so each hour needs its own automation.

1. In Shortcuts, open Automation and add a new one.
2. Choose Time of Day, set the hour, and set Repeat to Daily.
3. Choose Run Immediately, so it runs without asking.
4. Set it to run "Log state".
5. Repeat for each hour you want a reading.

Test one automation with the phone locked before adding the rest. iOS encrypts
Health data while the phone is locked, so step 1 may return nothing overnight.
The record then has a `heartRate` of 0 or none, and the site treats that as no
reading.

## Notes

- Every reading is public, and anyone watching the network can keep a copy
  after you delete the record.
  Heart rate, activity and battery level together show when you are asleep, out
  or exercising. Leave a field out of step 8 to stop publishing it.
- Hourly readings add 24 records a day. If you prune old ones, keep any that an
  `is.braxton.now` record points at, or that status loses its reading.
- By default a PDS allows 300 sign-ins per account per day. Hourly readings use
  24 and each status uses 2 on the main account.
