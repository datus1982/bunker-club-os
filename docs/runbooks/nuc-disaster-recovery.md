# NUC DISASTER RECOVERY — backing up and rebuilding the bar's mini PC

The mini PC behind the bar (`BUNKERCLUB-NUC`) is the venue's always-on
appliance. If it dies, the bar TV goes dark, the movie courier stops, and the
remote hands into the building are gone. This runbook is the answer to
Stephen's question — *"if I suddenly had to replace this, could I just do it in
one step?"*

**Honest answer: one script plus about four things a script cannot do.** Those
four are named in [§6](#6-what-cant-be-scripted). Nothing is hidden.

Companion pieces:

| file | what it is |
|------|------------|
| `scripts/bunker-nuc-backup.sh` | runs on the Mac, weekly; pulls the NUC's identity + config |
| `scripts/bunker-nuc-rebuild.ps1` | runs on the NEW machine; does everything scriptable |
| `docs/runbooks/nuc-kiosk-hardening.ps1` | vendored copy of Stephen's kiosk-hardening gist |
| `docs/runbooks/media-courier-pc-ssh-standalone.ps1` | the field-proven SSH provisioner (reused, not rewritten) |
| `docs/runbooks/media-courier.md` | how the movie pipeline works day to day |

> ⚠ **`bunker-nuc-rebuild.ps1` is UNTESTED ON METAL.** Every path, URL, version
> and command in it was cross-checked against the live NUC on 2026-08-23, and it
> parses clean. It has never been run end-to-end, because there is no spare
> Windows box to run it on. Treat the first real run as a supervised procedure
> with this page open.

---

## 1. What is actually on this machine

Taken live, read-only, on 2026-08-23. Some of it was a surprise — this is not
only the media appliance.

**Hardware.** SZ ReachingTech "DreamQuest Pro Plus" mini PC · Intel N150 ·
15.7 GB RAM · BIOS 5.27 · Windows 11 Pro build 10.0.26200 · timezone Central.
Internal disk: KingFast 477 GB (`C:`, NTFS). **The media library is an external
USB disk** — a WD My Book 25ED, 3726 GB, formatted **exFAT**, mounted as `D:`
with volume label `bunkerClub`.

**The Bunker stack** (what this kit rebuilds):

| piece | where | autostart |
|-------|-------|-----------|
| Bunker Media Shell **0.2.0** | `%LOCALAPPDATA%\Programs\Bunker Media Shell\` | `HKCU:…\Run` → `electron.app.Bunker Media Shell` |
| its config + caches | `%APPDATA%\Bunker Media Shell\` (`config.json`, `catalog-cache.json`, `sent-thumbs.json`, `logs\`) | — |
| Syncthing **v2.1.3** | binary `C:\Syncthing\`, **config `%LOCALAPPDATA%\Syncthing\`** | Scheduled Task `Syncthing (Bunker Courier)`, at logon, user `admin` |
| media library | `D:\bunkerClub` — 787 files, **1846.5 GiB**, 32 playlist folders | — |
| Win32-OpenSSH **10.0.0.0** | `C:\Program Files\OpenSSH\`, keys in `C:\ProgramData\ssh\` | service `sshd`, Automatic |
| Tailscale **1.102.3** | `C:\Program Files\Tailscale\` | service, + tray shortcut in All-Users Startup |

Autologon is on: `AutoAdminLogon=1`, `DefaultUserName=admin`,
`DefaultDomainName=BUNKERCLUB-NUC`, shell `explorer.exe`.

**The surprises — things the known inventory missed.** None of them are ours,
all of them are load-bearing for the *venue*, and none of them are restored by
this kit:

- **Q-SYS Designer 9.13** (QSC). The Q-SYS design software is installed *on this
  machine*. If the NUC is replaced, whoever holds the Q-SYS design file needs to
  know — this box may be where it lives.
- **Sennheiser Control Cockpit 9.0.0.82**, running as a service
  (`ControlCockpit.Application.ServiceHost`) plus a device-API host and a tray
  app in All-Users Startup. Venue microphone management.
- **A full Audinate Dante suite** — Dante Controller 4.15, Control & Monitoring
  4.2 (`conmon` service), Discovery (`mDNSResponder`), Updater, Activator, plus
  ~20 firewall rules. Dante audio networking, part of the same AV chain.
- **RemotePC Host 7.6.89** (IDrive) — three services, a UI process, four
  scheduled tasks, and a Startup shortcut. This is a **second remote-access path
  into the machine**, independent of Tailscale/SSH, and it is a paid product
  with its own account.
- **Two other user profiles.** `bunke` (SID …-1005) and a disabled
  `Administrator`. `bunke` owns the RemotePC, OneDrive and Dante-update
  scheduled tasks — it is almost certainly the machine's original account from
  before it became the media appliance. Our kiosk user `admin` (SID …-1006) has
  its profile at `C:\Users\admin.BUNKERCLUB-NUC` (note the suffix: a stale
  `C:\Users\admin` folder also exists).

**Read this as: the NUC is the venue's AV workstation *and* the media
appliance.** A rebuild that only restores the Bunker stack leaves Stephen
without Q-SYS Designer, Dante Controller, Control Cockpit and RemotePC. Those
are owner/integrator territory — reinstalling them is on the same list as the
BIOS setting, and they are called out again in [§6](#6-what-cant-be-scripted).

Two smaller findings worth writing down:

- **The shell's Add/Remove entry says 0.1.0; the running binary is 0.2.0.** That
  is the field ZIP swap (the NSIS installer failed its own CRC check on this
  machine in July 2026). There is no uninstaller in the install directory. The
  version to trust is the `.exe`'s, not Programs & Features.
- `D:\bunker-media-shell-setup\` still holds the **old 0.1.0** installer from
  the original drive delivery. Ignore it; the current release URLs are in the
  rebuild script.

---

## 2. The backup

```bash
scripts/bunker-nuc-backup.sh          # or --quiet for cron/launchd
```

Runs on the **Mac**, pulls over SSH, and is **read-only on the PC** — it runs
PowerShell that only reads. Nothing is written, started or stopped on the
appliance, so it is safe during service (a quiet morning is still politer).

It writes `~/BunkerCuration/nuc-backup/nuc-backup-<stamp>.tar.gz` (mode 0600 in
a 0700 directory), keeps the newest 8, and logs to `nuc-backup.log`.

**What it captures — the parts that cannot be regenerated:**

| | why it matters |
|---|---|
| `syncthing/cert.pem`, `key.pem`, `config.xml` | the device identity. See [§4](#4-why-the-syncthing-identity-is-the-crown-jewel). |
| `media-shell/config.json` | slug (`landscape-bar`), the 64-char device token, `mediaDir`, port 48151, catalog URL |
| `media-shell/catalog-cache.json`, `sent-thumbs.json` | saves a full rescan; not required |
| `ssh/ssh_host_*` + `administrators_authorized_keys` + `sshd_config` | keeps `ssh` working from the Mac with no host-key warning and no re-provisioning |
| `inventory/manifest.txt` | ~210 lines: versions, drives, services, tasks, autostart, autologon, power, Defender, firewall, network, hardware |
| `inventory/media-listing.tsv.gz` | every media file with size and mtime — the checklist for verifying a restored library |

**What it deliberately does NOT capture:**

- **The media library.** 1.85 TB, re-shippable. [§5](#5-restoring-the-media) is
  the honest arithmetic.
- **Syncthing's `index-v2\` database** (~95 MB). Derived state; Syncthing
  rebuilds it by rehashing. That first rehash is slow off a USB disk — hours —
  which is a scheduling fact, not a problem.
- **The autologon password.** `netplwiz` stores it as an LSA secret, not in the
  registry. It genuinely is not recoverable from a backup. You type it.
- **Q-SYS / Dante / Sennheiser / RemotePC** and their configuration.

⚠ **The tarball contains secrets** — the media device token, Syncthing's private
key, and sshd's host private keys. Never commit it, mail it, or put it on shared
storage. The inventory manifest is deliberately sanitised (it records
*token present, 64 chars* and *apikey-present=True*, never the values).

### The weekly job

A LaunchAgent `com.bunker.nuc-backup` runs it **Sundays at 05:00**, matching the
existing `com.bunker.*` pattern on the Mac:

```bash
launchctl list | grep nuc-backup          # confirm it's loaded
tail ~/BunkerCuration/nuc-backup/nuc-backup.log
```

> **Merge dependency.** The agent invokes
> `/Users/admin/bunker-club-os/scripts/bunker-nuc-backup.sh` — the canonical
> path in the main checkout. Until this branch merges, that file does not exist
> there and the Sunday run will no-op with an error. It starts working the
> moment the PR lands. To remove the job:
> `launchctl bootout gui/501/com.bunker.nuc-backup` and delete
> `~/Library/LaunchAgents/com.bunker.nuc-backup.plist`.

### A note for whoever touches the backup script next

`ssh host "powershell -Command -"` parses stdin the way an interactive console
does and **silently stops at the first multi-line block** — everything after it
is dropped, with no error and exit status 0. That produced a truncated manifest
on the first run here. The script therefore base64-encodes each PowerShell
script and `Invoke-Expression`s it on the far side, which runs it as one script
and keeps the ssh command line far below cmd.exe's 8191-character limit. Don't
"simplify" that back.

---

## 3. The rebuild

Order matters. Steps 1–3 are yours; step 4 is the script.

1. **Install Windows 11 Pro** on the replacement machine. Local account named
   `admin`. Skip the Microsoft-account nag.
2. **Attach the media disk** and, in Disk Management, **assign it the letter
   `D:`**. Every config in the backup says `D:\bunkerClub`. The script can
   rewrite both Syncthing's folder path and the shell's `mediaDir` if you land
   on a different letter, but matching the old one saves it having to.
3. **Get the kit onto the machine** — a USB stick with the backup tarball,
   `bunker-nuc-rebuild.ps1`, `nuc-kiosk-hardening.ps1` and
   `media-courier-pc-ssh-standalone.ps1`. The rebuild script looks for the two
   helpers beside itself or in a sibling `docs\runbooks\`.
4. **Run it, elevated:**

   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   .\bunker-nuc-rebuild.ps1 -Backup E:\nuc-backup-20260823-115518.tar.gz
   ```

   Useful switches: `-WhatIfOnly` (unpack and validate the backup, change
   nothing — **do this first**), `-MediaDir 'F:\bunkerClub'`,
   `-TailscaleAuthKey tskey-…`, `-SkipHardening`, `-SkipShell`.

   Every step is idempotent. If it stops, fix the cause and run it again.

What it does, in order: unpack and validate the backup → kiosk hardening →
OpenSSH via the proven standalone MSI script, then **restore the old host keys**
→ Tailscale → Syncthing installed and **its identity restored before the first
start** → media shell (ZIP path) + `config.json` + the autostart Run key →
verification → a printed list of what is still on you.

**Mint a Tailscale auth key first** if you want the run to be hands-off:
login.tailscale.com → Settings → Keys → generate a reusable/ephemeral-off key,
pass it as `-TailscaleAuthKey`. Without one the script **warns and carries on** —
it installs Tailscale, notes that it is not signed in, and prints the `tailscale
up` command in the closing manual-steps list. Nothing after that step depends on
the tailnet, so the sign-in can wait until the bar is back on the air. (You will
want it before you try to `ssh` in from the Mac, since port 22 is scoped to the
Tailscale range.)

### Proving it worked

- The script prints `IDENTITY PRESERVED` if the rebuilt machine's Syncthing
  device ID is one the restored `config.xml` already lists. That is the whole
  ballgame — see §4.
- From the Mac: `ssh -i ~/.ssh/bunker_pc_ed25519 admin@<tailnet-ip>` should
  connect **with no host-key warning**. A warning means the host-key restore
  didn't take.
- On the PC: `curl http://127.0.0.1:48151/health` → `{"ok":true,"fileCount":…}`.
- From the Mac, heartbeat-first: `signage_slots.last_seen` for `landscape-bar`
  should go fresh within a minute of the shell starting.
- Compare the restored library against `inventory/media-listing.tsv.gz`.

---

## 4. Why the Syncthing identity is the crown jewel

A Syncthing device ID **is** the SHA-256 of that device's TLS certificate. The
official documentation is explicit that `cert.pem` and `key.pem` "form the basis
for the device ID"
([docs.syncthing.net/users/config.html](https://docs.syncthing.net/users/config.html)),
and the FAQ frames forging an ID as needing "a TLS certificate with that
specific SHA-256 hash"
([docs.syncthing.net/users/faq.html](https://docs.syncthing.net/users/faq.html)).

So: drop the old `cert.pem`, `key.pem` and `config.xml` into
`%LOCALAPPDATA%\Syncthing\` **before Syncthing ever runs**, and the rebuilt
machine comes up as the *same device* — ID `ZXDRITN-TKPNTNG-…`. The Mac already
has that ID as a known device and already shares `bunkerclub-media` with it, so
the two reconnect on their own. No adding a device, no re-sharing, no accepting
on either end.

Let Syncthing start first and it generates a brand-new identity, which you then
cannot get rid of without doing this same restore anyway — and in the meantime
you would have to redo the pairing by hand
(`docs/runbooks/media-courier.md` §4).

**Caveat, stated plainly:** the Syncthing docs do not publish a formal
"migrate to a new machine" procedure. The mechanism above follows directly from
what they *do* document about where the ID comes from, and the rebuild script
verifies the outcome rather than assuming it — it reads the running device ID
back from the API and compares it against the restored config, printing
`IDENTITY PRESERVED` or a loud warning. Trust the check, not the theory.

The restored config also carries the two settings that make the courier safe —
`type=sendreceive` and `ignoreDelete=true`. The script re-checks both and warns
if either is wrong, because that pair is what stops a delete on the Mac from
emptying the bar.

---

## 5. Restoring the media

1846.5 GiB · 787 files · 269 films · 32 playlist folders.

### The measured basis

Taken live from the Mac's Syncthing REST API on 2026-08-23:

| measurement | value |
|---|---|
| bytes sent Mac → NUC since the 2026-08-22 restart | 423,220,907,607 |
| Syncthing uptime over that window | 90,789 s (25.2 h) |
| **sustained rate** | **4.66 MB/s ≈ 37 Mbps ≈ 394 GiB/day** |
| curation-wave pace (prep *and* ship, real world) | 68 of 150 titles in ~2 days ≈ **34 titles/day** |

### Option A — re-ship over Syncthing (the trickle)

**Floor: ~5 days** of continuous transfer (1.98 TB ÷ 4.66 MB/s ≈ 118 hours).
**Realistic: 8–12 days**, because that floor assumes the link runs flat out and
every file is already prepared. In practice each title is pulled from the
master library over SMB, runtime-checked against TMDB, normalised or
transcoded, and released through the driver's 30 GB outbox throttle — the
observed 34 titles/day is the number that has actually happened.

**And it cannot fully restore the library.** At least nine titles exist nowhere
any more (the re-acquire list: Rambo II, Rambo III, Beverly Hills Cop II, Pitch
Perfect, Moonage Daydream, Let It Be, the two Bowie documentaries, Hotel
California), plus Wild Style (metadata only) and Bloodsport (Blu-ray ISO,
needs a remux pass). Option A rebuilds *most* of the library, not all of it.

Zero extra cost, zero maintenance, no drive to keep track of. As a **trickle
heal** running behind a faster restore, it is exactly right.

### Option B — a USB clone kept at the bar ✅ recommended as primary

A second external disk holding a straight copy of `D:\bunkerClub`, living at the
venue. Restore = plug it in, assign `D:`, done. **Hours, not days** — and for
the truly urgent case (swap the disk into the new machine) **minutes**, because
the library never moves at all.

It also covers the titles Option A can't: it is a copy of what the bar actually
has, including anything that no longer exists at home.

The cost is discipline: it goes stale the moment new films ship. Refresh it
after each curation wave, or monthly. A refresh is a one-way sync from `D:` to
the clone — nothing on the bar changes, so it is safe to do during service.

**This is the recommendation.** The bar's real exposure is *how long the TV is
dark*, and only Option B answers that in the same day.

### Option C — the original 2026-07 burn drive

If the 4 TB exFAT drive from the original install is still at the venue, it is a
usable **base layer**: 389 normalised files as of the July burn. Everything
since — the entire curation wave — is missing, and it predates the TV-episode
purge, so it would drag back 143 episode files the owner has since deleted.

Use it only if B doesn't exist and you want something on screen tonight; then
let A trickle the rest in and re-purge the episodes.

### Recommended posture

**B as primary, A as the trickle heal.** Clone drive gets the bar back on the
air the same day; Syncthing quietly closes the gap between the clone's last
refresh and today. C is the fallback if the clone was never made.

---

## 6. What can't be scripted

Named honestly, in the order you'll hit them.

1. **Installing Windows.** Media creation, OOBE, the local-account dance.
2. **The Tailscale login.** Interactive browser sign-in as `datus1982` — unless
   you mint a pre-auth key beforehand and pass `-TailscaleAuthKey`, which turns
   this one into a scripted step. Do that. It is *deferrable* either way: the
   rebuild warns and continues without it, and nothing else in the script needs
   the tailnet. It is only remote access to the finished machine that waits.
3. **Auto-logon (`netplwiz`).** Settings → Accounts → Sign-in options → turn
   **off** "only allow Windows Hello sign-in", then `netplwiz` → untick "Users
   must enter a user name and password" → type the password. **The password is
   not in the backup** — Windows keeps it as an LSA secret. There is no honest
   way around typing it.
4. **BIOS: Restore on AC Power Loss → Power On.** Without it the bar screen
   stays dark after any power blip, and nobody notices until service.
5. **The media library.** [§5](#5-restoring-the-media).
6. **The venue AV stack — Q-SYS Designer, Dante Controller/Updater, Sennheiser
   Control Cockpit, RemotePC Host.** Licensed third-party software with its own
   accounts and its own configuration, none of it ours to automate. If the NUC
   is replaced, this is a call to Stephen and the integrator, and it is the
   longest pole that this kit does *not* carry. Worth deciding, before the bad
   day, whether that stack should live on this machine at all.

---

## 7. NUC roles — where this is going

**Owner ruling, 2026-08-23: the NUC is the venue's always-on executor. No
automatic task may depend on the iPad.** The iPad (Bunker Control, and the Q-SYS
UCI before it) is a *remote control* — a surface a person picks up. Anything
that has to happen on a schedule, or keep happening when nobody is holding
anything, runs here.

Today that means the media shell and the Syncthing courier. Next it means
**`bunker-agent`** — the audio daypart/scene executor, with a Sonos lane
(program selection over local UPnP :1400) and a QRC lane (levels, fades,
source switching on the Q-SYS Core). Scenes and dayparts have to fire whether or
not an iPad is awake, which is precisely why they land on this box.

**When `bunker-agent` ships, it must be added to this kit.** Concretely:

- `scripts/bunker-nuc-backup.sh` — add its config/state paths to the fetch list
  (they will hold the QRC control-name map and the Sonos favourite/scene
  definitions, and likely a token).
- `scripts/bunker-nuc-rebuild.ps1` — add an install + restore + autostart step,
  and add it to the verification pass.
- §1 of this page — add it to the stack table.

An executor that isn't in the backup is an executor that doesn't come back. Fold
it in as part of shipping it, not afterwards.

---

## 8. Quick reference

```bash
# back up now (Mac)
scripts/bunker-nuc-backup.sh

# what's in the newest backup
ls -lt ~/BunkerCuration/nuc-backup/ | head
tar tzf ~/BunkerCuration/nuc-backup/nuc-backup-<stamp>.tar.gz

# read the inventory without unpacking
tar xzOf ~/BunkerCuration/nuc-backup/nuc-backup-<stamp>.tar.gz \
  nuc-backup-<stamp>/inventory/manifest.txt | less

# the media checklist
tar xzOf ~/BunkerCuration/nuc-backup/nuc-backup-<stamp>.tar.gz \
  nuc-backup-<stamp>/inventory/media-listing.tsv.gz | gunzip | less

# remote hands
ssh -i ~/.ssh/bunker_pc_ed25519 admin@100.68.29.108

# is the courier caught up?
scripts/bunker-ship-status.sh
```

⚠ This is the live bar appliance. Heartbeat-first: check
`signage_slots.last_seen` before and after anything that could disturb playback,
and prefer quiet mornings.
