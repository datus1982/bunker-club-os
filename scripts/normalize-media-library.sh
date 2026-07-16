#!/bin/bash
# =============================================================================
# normalize-media-library.sh  —  Bunker Club OS media module (docs/15, M1)
# -----------------------------------------------------------------------------
# Normalizes a movie library IN PLACE so every file plays in a Chromium <video>
# element (the media-shell's playback surface: apps/media-shell).
#
# Playback target:  H.264 video + AAC audio in an .mp4 container, max 1080p.
# Shell visibility:  apps/media-shell only indexes .mp4/.mkv/.webm/.mov
#                    (see VIDEO_EXTENSIONS in apps/media-shell/src/constants.js).
#                    .avi is INVISIBLE to the shell, so it is always rebuilt to .mp4.
#
# USAGE
#   normalize-media-library.sh <root-dir> [--apply] [--jobs N]
#
#   <root-dir>   directory tree to normalize (searched recursively)
#   --apply      actually run ffmpeg. WITHOUT this flag the script is a DRY RUN:
#                it classifies every file, prints a per-file plan, and prints a
#                summary table (counts + estimated GB per category). Nothing is
#                changed in a dry run.
#   --jobs N     number of parallel ffmpeg workers when --apply'ing (default 2).
#
# CLASSIFICATION (per file, from the FIRST video/audio stream via ffprobe)
#   OK        playable video (h264/av1/vp9) AND playable audio (aac/mp3/flac/
#             opus/vorbis, or NO audio stream) AND a shell-visible container
#             (.mp4/.mkv/.webm/.mov). -> skipped, left untouched.
#   REMUX     playable video but non-playable audio (ac3/eac3/dts/truehd/...).
#             Video is stream-copied, audio re-encoded to stereo AAC, written to
#             .mp4. Fast (no video re-encode).
#   TRANSCODE non-playable video codec (hevc/vc1/mpeg2/...), OR an .avi container
#             regardless of codecs. Full H.264 re-encode, capped at 1920x1080,
#             audio to stereo AAC, written to .mp4. Slow.
#
# SAFETY / RESUMABILITY
#   * ffmpeg writes to "<base>.norm.tmp.mp4" in the same directory.
#   * On success the output is VERIFIED (duration within max(5s, 3%) of source,
#     video==h264, audio==aac-or-none, size>1MB) before it replaces anything.
#   * Only after a passing verify is the temp atomically moved to "<base>.mp4"
#     and the ORIGINAL source deleted (when the source path differs from the
#     final path; if the source was already a same-named .mp4 the temp is moved
#     over it).
#   * On ANY failure the source is left untouched, the temp is removed, the
#     failure is logged, and the run continues.
#   * Idempotent: a re-run re-classifies everything; already-normalized files
#     classify OK and are skipped. Stale "*.norm.tmp.mp4" leftovers from an
#     interrupted run are cleaned at startup (on --apply).
#
# exFAT NOTE
#   The target drive is exFAT, which gives no atomic-rename guarantee ACROSS
#   directories, but a mv WITHIN the same directory (which is all we do) is fine
#   in practice. We never rename across directories.
#
# LOGGING
#   Appends timestamped per-file results + a run summary to "<root>/normalize.log".
#   A single result line is short (< PIPE_BUF 4096 bytes) so an O_APPEND ">>"
#   write is effectively atomic even across parallel workers.
#
# REQUIRES: ffmpeg + ffprobe on PATH. Prefers the hardware H.264 encoder
#           (h264_videotoolbox); falls back to libx264 with a warning.
# =============================================================================

# NOTE: intentionally NOT using `set -e` — per-file failures are handled
# explicitly so one bad file never aborts the whole run.
set -uo pipefail

# ---- codec policy -----------------------------------------------------------
GOOD_VIDEO_RE='^(h264|av1|vp9)$'
GOOD_AUDIO_RE='^(aac|mp3|flac|opus|vorbis)$'
VISIBLE_EXT_RE='^(mp4|mkv|webm|mov)$'   # what the media-shell can index (.avi excluded)

SIZE_FLOOR=1048576   # 1 MiB — a verified output must exceed this

# =============================================================================
# ffprobe helpers  (first stream only; empty output == absent)
# =============================================================================
probe_vcodec() { ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null | head -1; }
probe_acodec() { ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null | head -1; }
probe_duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1; }
probe_height() { ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$1" 2>/dev/null | head -1; }
probe_width() { ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$1" 2>/dev/null | head -1; }

file_size() { stat -f%z "$1" 2>/dev/null || echo 0; }
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
ext_of() { local b; b=$(basename -- "$1"); case "$b" in *.*) lc "${b##*.}";; *) echo "";; esac; }

# human-readable bytes -> GiB with 2 decimals (awk, no bc dependency)
bytes_to_gb() { awk -v b="$1" 'BEGIN{printf "%.2f", b/1073741824}'; }
bytes_to_h() { awk -v b="$1" 'BEGIN{ if(b>=1073741824)printf "%.1fG",b/1073741824; else if(b>=1048576)printf "%.0fM",b/1048576; else printf "%dK",b/1024 }'; }

# classify <file>  ->  echoes one of: OK REMUX TRANSCODE
# Uses only the first video + first audio stream.
classify() {
  local f="$1" ext v a
  ext=$(ext_of "$f")
  # .avi is never OK and never a simple remux — the container is shell-invisible.
  if [ "$ext" = "avi" ]; then echo TRANSCODE; return; fi

  v=$(probe_vcodec "$f")
  a=$(probe_acodec "$f")

  local good_video=0 good_audio=0 visible=0
  printf '%s' "$v" | grep -Eq "$GOOD_VIDEO_RE" && good_video=1
  # no audio stream (empty) counts as "good" — nothing to fix on the audio side
  if [ -z "$a" ]; then good_audio=1; else printf '%s' "$a" | grep -Eq "$GOOD_AUDIO_RE" && good_audio=1; fi
  printf '%s' "$ext" | grep -Eq "$VISIBLE_EXT_RE" && visible=1

  # OWNER-RULED 2026-07-16 ("1080p is fine"): playable-codec files ABOVE 1080p
  # (e.g. Perfect Blue h264 3840x2160, the AV1 4K Bowie doc) are routed to
  # TRANSCODE so everything on the drive lands <=1080p — 4K software decode
  # (esp. AV1) could stutter on the bar's mini PC.
  local h w oversize=0
  h=$(probe_height "$f"); w=$(probe_width "$f")
  if [ -n "$h" ] && [ "$h" -gt 1080 ] 2>/dev/null; then oversize=1; fi
  if [ -n "$w" ] && [ "$w" -gt 1920 ] 2>/dev/null; then oversize=1; fi

  if [ "$good_video" -eq 0 ] || [ "$oversize" -eq 1 ]; then
    echo TRANSCODE          # bad video codec, or playable but >1080p -> full re-encode
  elif [ "$good_audio" -eq 1 ] && [ "$visible" -eq 1 ]; then
    echo OK                 # nothing to do
  else
    echo REMUX              # good video, bad audio (visible container) -> audio-only remux
  fi
}

# =============================================================================
# WORKER MODE  —  invoked as:  bash <self> --worker <file>
# Runs as its own process under xargs -P. Reads config from BML_* env vars.
# Re-probes/re-classifies its file (self-contained + naturally idempotent).
# =============================================================================
if [ "${1:-}" = "--worker" ]; then
  f="$2"
  APPLY="${BML_APPLY:-0}"
  VENC_KIND="${BML_VENC_KIND:-x264}"
  LOGFILE="${BML_LOG:-/dev/null}"
  ROOT="${BML_ROOT:-/}"
  TOTAL="${BML_TOTAL:-0}"
  COUNTER_FILE="${BML_COUNTER:-/dev/null}"
  COUNTER_LOCK="${BML_LOCK:-/tmp/.bml.lock}"

  ts() { date +'%Y-%m-%dT%H:%M:%S%z'; }
  logln() { printf '%s\t%s\n' "$(ts)" "$1" >> "$LOGFILE"; }   # single short line => atomic append

  # atomic counter via mkdir-mutex (no flock on stock macOS)
  next_idx() {
    local n
    while ! mkdir "$COUNTER_LOCK" 2>/dev/null; do :; done
    n=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$COUNTER_FILE"
    rmdir "$COUNTER_LOCK"
    printf '%s' "$n"
  }

  rel="${f#$ROOT/}"
  idx=$(next_idx)
  cat=$(classify "$f")
  start=$(date +%s)

  if [ "$cat" = "OK" ]; then
    printf '[%s/%s] %-9s SKIP  %s\n' "$idx" "$TOTAL" "OK" "$rel"
    logln "SKIP	OK	$rel"
    exit 0
  fi

  a=$(probe_acodec "$f"); has_audio=0; [ -n "$a" ] && has_audio=1
  src_dur=$(probe_duration "$f")
  tmp="${f%.*}.norm.tmp.mp4"
  final="${f%.*}.mp4"

  # ---- build ffmpeg command ------------------------------------------------
  cmd=(ffmpeg -y -nostdin -loglevel error -i "$f" -map 0:v:0)
  [ "$has_audio" -eq 1 ] && cmd+=(-map 0:a:0)
  if [ "$cat" = "REMUX" ]; then
    cmd+=(-c:v copy)
  else
    if [ "$VENC_KIND" = "vt" ]; then
      cmd+=(-c:v h264_videotoolbox -b:v 6000k)
    else
      cmd+=(-c:v libx264 -preset fast -crf 20)
    fi
    # cap at 1920x1080 preserving aspect; keep dims even; 8-bit for Chromium
    cmd+=(-vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" -pix_fmt yuv420p)
  fi
  [ "$has_audio" -eq 1 ] && cmd+=(-c:a aac -b:a 192k -ac 2)
  cmd+=(-movflags +faststart "$tmp")

  if [ "$APPLY" != "1" ]; then
    # (worker only runs under --apply; guard just in case)
    exit 0
  fi

  rm -f "$tmp"
  fail() {
    rm -f "$tmp"
    local el=$(( $(date +%s) - start ))
    printf '[%s/%s] %-9s FAIL  %s  (%s)\n' "$idx" "$TOTAL" "$cat" "$rel" "$1"
    logln "FAIL	$cat	$rel	$1	${el}s"
    exit 0
  }

  "${cmd[@]}" 2>>"$LOGFILE" || fail "ffmpeg-rc-$?"

  # ---- verify --------------------------------------------------------------
  [ -f "$tmp" ] || fail "no-output"
  out_v=$(probe_vcodec "$tmp")
  out_a=$(probe_acodec "$tmp")
  out_dur=$(probe_duration "$tmp")
  out_sz=$(file_size "$tmp")

  [ "$out_v" = "h264" ] || fail "bad-vcodec:$out_v"
  if [ -n "$out_a" ] && [ "$out_a" != "aac" ]; then fail "bad-acodec:$out_a"; fi
  [ "$out_sz" -gt "$SIZE_FLOOR" ] || fail "too-small:${out_sz}b"

  # duration tolerance: within max(5s, 3% of source). If source duration is
  # unknown/non-numeric, fall back to requiring a positive output duration.
  dur_ok=$(awk -v s="$src_dur" -v o="$out_dur" 'BEGIN{
    if (o+0 <= 0) { print 0; exit }
    if (s+0 <= 0) { print 1; exit }         # unknown source dur -> best effort
    tol = s*0.03; if (tol < 5) tol = 5;
    d = s - o; if (d < 0) d = -d;
    print (d <= tol) ? 1 : 0;
  }')
  [ "$dur_ok" = "1" ] || fail "dur-mismatch:src=${src_dur}:out=${out_dur}"

  # ---- commit: move temp into place, delete source if distinct -------------
  if [ "$f" = "$final" ]; then
    mv -f "$tmp" "$f"           # source was already this exact .mp4
  else
    mv -f "$tmp" "$final" || fail "mv-failed"
    rm -f "$f"                  # remove the now-superseded source (.mkv/.avi/etc)
  fi

  el=$(( $(date +%s) - start ))
  printf '[%s/%s] %-9s OK    %s  (%s, %ss)\n' "$idx" "$TOTAL" "$cat" "$rel" "$(bytes_to_h "$out_sz")" "$el"
  logln "${cat}-OK	$cat	$rel	${el}s	out=$(bytes_to_h "$out_sz")"
  exit 0
fi

# =============================================================================
# MAIN
# =============================================================================
usage() { sed -n '2,40p' "$0"; exit "${1:-0}"; }

ROOT=""; APPLY=0; JOBS=2
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift;;
    --jobs) JOBS="${2:-2}"; shift 2;;
    --jobs=*) JOBS="${1#--jobs=}"; shift;;
    -h|--help) usage 0;;
    -*) echo "unknown option: $1" >&2; usage 1;;
    *) if [ -z "$ROOT" ]; then ROOT="$1"; else echo "unexpected arg: $1" >&2; usage 1; fi; shift;;
  esac
done

[ -n "$ROOT" ] || { echo "error: <root-dir> required" >&2; usage 1; }
[ -d "$ROOT" ] || { echo "error: not a directory: $ROOT" >&2; exit 1; }
case "$JOBS" in ''|*[!0-9]*) echo "error: --jobs must be a positive integer" >&2; exit 1;; esac
[ "$JOBS" -ge 1 ] || JOBS=1

# normalize ROOT (strip trailing slash) and resolve to absolute for stable rel-paths
ROOT="${ROOT%/}"
case "$ROOT" in /*) : ;; *) ROOT="$(cd "$ROOT" && pwd)";; esac

command -v ffmpeg  >/dev/null 2>&1 || { echo "error: ffmpeg not found on PATH"  >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "error: ffprobe not found on PATH" >&2; exit 1; }

# choose H.264 encoder
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_videotoolbox'; then
  VENC_KIND="vt"; VENC_LABEL="h264_videotoolbox (hardware)"
else
  VENC_KIND="x264"; VENC_LABEL="libx264 -preset fast -crf 20 (software fallback)"
  echo "WARNING: h264_videotoolbox not available — using software libx264 (much slower)." >&2
fi

SELF="$0"
LOGFILE="$ROOT/normalize.log"
MODE="DRY RUN"; [ "$APPLY" -eq 1 ] && MODE="APPLY"

echo "==============================================================="
echo " Bunker media normalize — $MODE"
echo " root:    $ROOT"
echo " encoder: $VENC_LABEL"
echo " jobs:    $JOBS"
echo " log:     $LOGFILE"
echo "==============================================================="

# ---- stale temp cleanup (report in dry-run, delete on apply) ----------------
stale_n=0
while IFS= read -r -d '' t; do
  stale_n=$((stale_n+1))
  if [ "$APPLY" -eq 1 ]; then
    rm -f "$t"; echo "cleaned stale temp: ${t#$ROOT/}"
  else
    echo "would clean stale temp: ${t#$ROOT/}"
  fi
done < <(find "$ROOT" -type f -name '*.norm.tmp.mp4' -print0 2>/dev/null)
[ "$stale_n" -gt 0 ] && echo "---"

# ---- classification pass (single-threaded probe of every candidate) ---------
# Parallel arrays keyed by index. bash 3.2: no associative arrays.
FILES=(); CATS=()
c_ok=0; c_remux=0; c_transcode=0
b_ok=0; b_remux=0; b_transcode=0

echo "Scanning for video files..."
while IFS= read -r -d '' f; do
  cat=$(classify "$f")
  sz=$(file_size "$f")
  case "$cat" in
    OK)        c_ok=$((c_ok+1)); b_ok=$((b_ok+sz));;
    REMUX)     c_remux=$((c_remux+1)); b_remux=$((b_remux+sz)); FILES+=("$f"); CATS+=("REMUX");;
    TRANSCODE) c_transcode=$((c_transcode+1)); b_transcode=$((b_transcode+sz)); FILES+=("$f"); CATS+=("TRANSCODE");;
  esac
  printf '  %-9s %s  (%s)\n' "$cat" "${f#$ROOT/}" "$(bytes_to_h "$sz")"
done < <(find "$ROOT" -type f \( \
            -iname '*.mp4' -o -iname '*.mkv' -o -iname '*.webm' -o -iname '*.mov' -o -iname '*.avi' \
         \) ! -iname '*.norm.tmp.mp4' -print0 2>/dev/null | sort -z)

total_files=$((c_ok + c_remux + c_transcode))
work_n=$((c_remux + c_transcode))

echo
echo "================= PLAN SUMMARY ================="
printf '  %-11s %6s   %10s\n' "CATEGORY" "FILES" "EST. GB"
printf '  %-11s %6s   %10s\n' "-----------" "-----" "----------"
printf '  %-11s %6d   %10s\n' "OK/skip"   "$c_ok"        "$(bytes_to_gb $b_ok)"
printf '  %-11s %6d   %10s\n' "REMUX"     "$c_remux"     "$(bytes_to_gb $b_remux)"
printf '  %-11s %6d   %10s\n' "TRANSCODE" "$c_transcode" "$(bytes_to_gb $b_transcode)"
printf '  %-11s %6s   %10s\n' "-----------" "-----" "----------"
printf '  %-11s %6d   %10s\n' "TOTAL"     "$total_files" "$(bytes_to_gb $((b_ok+b_remux+b_transcode)))"
echo "================================================"
echo "  work items (remux+transcode): $work_n"
echo

# run-summary log line
printf '%s\tSCAN\ttotal=%d ok=%d remux=%d transcode=%d mode=%s encoder=%s\n' \
  "$(date +'%Y-%m-%dT%H:%M:%S%z')" "$total_files" "$c_ok" "$c_remux" "$c_transcode" "$MODE" "$VENC_KIND" >> "$LOGFILE"

if [ "$APPLY" -ne 1 ]; then
  echo "DRY RUN — nothing changed. Re-run with --apply to execute."
  exit 0
fi

if [ "$work_n" -eq 0 ]; then
  echo "Nothing to do — every file is already OK."
  exit 0
fi

# ---- apply: dispatch workers via xargs -P (NUL-delimited, space-safe) -------
COUNTER_FILE="$(mktemp)"; printf '0' > "$COUNTER_FILE"
COUNTER_LOCK="$(mktemp -d)"; rmdir "$COUNTER_LOCK"   # want the NAME free for mkdir-mutex
TASKS="$(mktemp)"

i=0
while [ "$i" -lt "${#FILES[@]}" ]; do
  printf '%s\0' "${FILES[$i]}" >> "$TASKS"
  i=$((i+1))
done

export BML_APPLY=1
export BML_VENC_KIND="$VENC_KIND"
export BML_LOG="$LOGFILE"
export BML_ROOT="$ROOT"
export BML_TOTAL="$work_n"
export BML_COUNTER="$COUNTER_FILE"
export BML_LOCK="$COUNTER_LOCK"

echo "Processing $work_n file(s) with $JOBS worker(s)..."
run_start=$(date +%s)

xargs -0 -P "$JOBS" -n1 bash "$SELF" --worker < "$TASKS"

run_el=$(( $(date +%s) - run_start ))
rm -f "$TASKS" "$COUNTER_FILE"; rmdir "$COUNTER_LOCK" 2>/dev/null || true

# tally results from the log's tail for this run
echo
echo "================= RUN COMPLETE ================="
echo "  elapsed: ${run_el}s"
echo "  see $LOGFILE for per-file results"
printf '%s\tDONE\telapsed=%ds work=%d\n' "$(date +'%Y-%m-%dT%H:%M:%S%z')" "$run_el" "$work_n" >> "$LOGFILE"
echo "================================================"
