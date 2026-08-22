#!/bin/bash
# =============================================================================
# bunker-add-movie.sh — Bunker Club OS "media courier" (Mac side)
# -----------------------------------------------------------------------------
# Prepares ONE movie for the bar's media PC and drops it into the Syncthing
# outbox. Syncthing ships it to the bar automatically; the media shell's
# chokidar watcher catalogs it live.
#
# USAGE
#   bunker-add-movie.sh <source-video> "<Playlist Folder>" [options]
#
#   <source-video>       any video file readable by ffprobe
#   "<Playlist Folder>"  the LITERAL first-level folder name on the bar library
#                        (e.g. "16_Action_80s"). Must match an existing bar
#                        folder to land in that playlist; a NEW name creates a
#                        NEW folder playlist at the bar (see runbook: new folder
#                        playlists are born carousel-ON).
#
# OPTIONS
#   --title "Title (Year)"  override the derived Kodi title
#   --no-normalize          never re-encode; copy/remux only (fails loudly if
#                           the source can't be stream-copied into .mp4)
#   --dry-run               print the plan and exit; changes nothing
#   -h, --help              this text
#
# OUTPUT LAYOUT (Kodi-style, matches the bar library)
#   $BUNKER_OUTBOX/<Playlist>/<Title (Year)>/<Title (Year)>.mp4
#   (+ an English .srt sidecar beside it when subliminal is available)
#
#   The media shell rolls nested files up into their FIRST-LEVEL ancestor
#   folder's playlist (apps/media-shell/src/mediaLibrary.js), so the per-movie
#   subfolder is free — it just keeps the sidecar .srt next to its video.
#
# ENVIRONMENT
#   BUNKER_OUTBOX      outbox root. Default: $HOME/BunkerClubOutbox
#                      (the Syncthing "Bunker Club Outbox" sendonly folder).
#                      Override for tests so the real outbox is never touched.
#   BUNKER_SUBLIMINAL  explicit path to the `subliminal` binary (optional).
#   BUNKER_SUB_MIN_SCORE  subliminal --min-score, 0-100. Default 50 (calibrated:
#                      a genuine "Title (Year)" match scored through, a made-up
#                      title's fuzzy match was rejected). Lower = more subs but
#                      a real risk of the WRONG film's subtitles.
#
# ENCODE POLICY — mirrors scripts/normalize-media-library.sh, which produced the
# bar's whole library. Playback target: H.264 (or another Chromium-decodable
# codec) + AAC audio in .mp4, max 1920x1080, +faststart.
#   COPY       source is already a compliant .mp4  -> plain file copy
#   REMUX      compliant codecs, wrong container   -> ffmpeg -c copy into .mp4
#   TRANSCODE  bad codec, or >1080p, or a failed   -> full H.264/AAC re-encode
#              remux verify                           (h264_videotoolbox when
#                                                      available, else libx264)
#
# SAFETY
#   * ffmpeg writes to a staging dir OUTSIDE the outbox but on the same
#     filesystem, then rename(2)s the finished file into place — Syncthing never
#     sees a partial file, even though the folder watcher has a 10s delay.
#   * Every output is VERIFIED before it moves: codecs, size floor, and
#     DURATION PARITY vs the source (max(5s, 3%)). The 2026-07 burn shipped
#     half-length features because metadata lied — duration parity is the check
#     that catches it.
#   * A remux that verifies badly automatically falls back to a full transcode
#     (unless --no-normalize).
#   * Re-running with the same title OVERWRITES the same relative path, which is
#     exactly how a replacement is shipped to the bar.
# =============================================================================

set -uo pipefail

# ---- policy (mirrors normalize-media-library.sh) ----------------------------
GOOD_VIDEO_RE='^(h264|av1|vp9)$'
GOOD_AUDIO_RE='^(aac|mp3)$'      # what we are willing to stream-copy INTO .mp4
SIZE_FLOOR=1048576               # 1 MiB

OUTBOX="${BUNKER_OUTBOX:-$HOME/BunkerClubOutbox}"
SUB_MIN_SCORE="${BUNKER_SUB_MIN_SCORE:-50}"

# ---- ffprobe helpers (first stream only; empty output == absent) ------------
probe_vcodec()   { ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null | head -1 | sed "s/,*$//"; }
probe_acodec()   { ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$1" 2>/dev/null | head -1 | sed "s/,*$//"; }
probe_duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1 | sed "s/,*$//"; }
probe_height()   { ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$1" 2>/dev/null | head -1 | sed "s/,*$//"; }
probe_width()    { ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$1" 2>/dev/null | head -1 | sed "s/,*$//"; }

file_size() { stat -f%z "$1" 2>/dev/null || echo 0; }

# has_faststart <mp4> -> exit 0 when the `moov` box precedes `mdat`.
# Walks the top-level box chain (no ffprobe equivalent exists). The bar plays
# over an HTTP Range server, so a moov-at-the-end file has to be fetched almost
# entirely before it can start or seek — the whole burned library is +faststart
# and new arrivals must match.
has_faststart() {
  perl -e '
    open(my $fh, "<:raw", $ARGV[0]) or exit 2;
    my $off = 0;
    for (1..64) {
      seek($fh, $off, 0) or exit 1;
      my $hdr; read($fh, $hdr, 8) == 8 or exit 1;
      my ($size, $type) = unpack("N a4", $hdr);
      if ($size == 1) { my $e; read($fh, $e, 8) == 8 or exit 1;
                        my ($hi,$lo) = unpack("N N", $e); $size = $hi*4294967296 + $lo; }
      exit 0 if $type eq "moov";
      exit 1 if $type eq "mdat";
      exit 1 if $size < 8;
      $off += $size;
    }
    exit 1;
  ' "$1"
}
lc()        { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
ext_of()    { local b; b=$(basename -- "$1"); case "$b" in *.*) lc "${b##*.}";; *) echo "";; esac; }
bytes_to_h(){ awk -v b="$1" 'BEGIN{ if(b>=1073741824)printf "%.1fG",b/1073741824; else if(b>=1048576)printf "%.0fM",b/1048576; else printf "%dK",b/1024 }'; }
secs_to_h() { awk -v s="$1" 'BEGIN{ if(s+0<=0){print "?"; exit} h=int(s/3600); m=int((s-h*3600)/60); sec=int(s-h*3600-m*60); printf "%d:%02d:%02d",h,m,sec }'; }

die()  { printf 'error: %s\n' "$1" >&2; exit 1; }
usage(){ sed -n '2,60p' "$0"; exit "${1:-0}"; }

# =============================================================================
# Title derivation — Kodi "Title (Year)" from a messy source filename.
# Cuts everything from the first scene-release token onward, then lifts a
# 1900–2099 year out of the remainder (parenthesized or bare).
# =============================================================================
derive_title() {
  perl -e '
    my $orig = $ARGV[0];
    my $b = $orig;
    $b =~ s/\.[A-Za-z0-9]{2,4}$//;              # strip extension
    # Separator normalization: "_" is always a separator; "." only counts as one
    # in classic scene naming (a basename with no spaces at all). This keeps
    # "Mr. Nobody (2013)" readable while still fixing "Some.Movie.2019...".
    $b =~ s/_+/ /g;
    $b =~ s/\.+/ /g unless $b =~ / /;

    # Cut everything from the first scene/quality token onward. The token must be
    # PRECEDED by real title text + a separator, so a film legitimately named
    # "Remux Case" or "Dual" is not annihilated by its own first word.
    my $tok = qr/(?:2160p|1440p|1080p|720p|480p|4k|uhd|x264|x265|h ?264|h ?265|hevc|xvid|divx|
                   bluray|blu ?ray|brrip|bdrip|bdremux|remux|webrip|web ?dl|webdl|hdrip|dvdrip|
                   dvdscr|hdtv|amzn|hmax|dsnp|atvp|aac\d*|ac3|eac3|dts[a-z-]*|truehd|ddp?5 1|
                   ddp?\d|10bit|8bit|hdr\d*|sdr|repack|proper|internal|limited|multi|dual|
                   yify|yts|rarbg|sparks|evo|fgt|ntb|cmrg|galaxyrg|psa)/xi;
    my $cut = $b;
    if ($cut =~ s/^(.+?)[\s\.\[\(\{\-]+$tok\b.*$/$1/s) {
      my $probe = $cut; $probe =~ s/[^A-Za-z0-9]//g;
      $b = $cut if $probe ne "";     # never let the cut empty the title
    }

    # Year: parenthesized wins, else the last bare 1900-2099 token.
    my $year = "";
    if ($b =~ /\(\s*((?:19|20)\d\d)\s*\)/) {
      $year = $1; $b =~ s/\(\s*(?:19|20)\d\d\s*\)//g;
    } elsif ($b =~ /.*\b((?:19|20)\d\d)\b/) {
      $year = $1;
      # Remove ONLY the year we took (the LAST one). Stripping every year token
      # would erase a title that IS a year — "1917 (2019)" -> " (2019)".
      $b =~ s/\b(?:19|20)\d\d\b(?!.*\b(?:19|20)\d\d\b)//s;
    }

    $b =~ s/[\[\]\(\)\{\}]/ /g;
    $b =~ s/\s{2,}/ /g;
    $b =~ s/^[\s\-–_.]+|[\s\-–_.]+$//g;

    # Last-resort guard: never return an empty title.
    if ($b !~ /[A-Za-z0-9]/) { $b = $orig; $b =~ s/\.[A-Za-z0-9]{2,4}$//; $b =~ s/[._]+/ /g; $b =~ s/^\s+|\s+$//g; $year = ""; }

    print $year ne "" ? "$b ($year)" : $b;
  ' "$1"
}

# Path-safe: strip characters that are illegal on exFAT/NTFS (the bar drive) or
# that would let a caller escape the outbox.
sanitize_component() {
  perl -e '
    my $s = $ARGV[0];
    $s =~ s{[/\\:*?"<>|]}{ }g;      # illegal on NTFS/exFAT
    $s =~ s/[\x00-\x1f]//g;
    $s =~ s/^\s+|\s+$//g; $s =~ s/\s{2,}/ /g;
    $s =~ s/\.+$//;                  # Windows drops trailing dots
    print $s;
  ' "$1"
}

# =============================================================================
# ARGS
# =============================================================================
SRC=""; PLAYLIST=""; TITLE=""; NO_NORMALIZE=0; DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --title)        TITLE="${2:-}"; shift 2;;
    --title=*)      TITLE="${1#--title=}"; shift;;
    --no-normalize) NO_NORMALIZE=1; shift;;
    --dry-run)      DRY_RUN=1; shift;;
    -h|--help)      usage 0;;
    -*)             echo "unknown option: $1" >&2; usage 1;;
    *)
      if   [ -z "$SRC" ]; then SRC="$1"
      elif [ -z "$PLAYLIST" ]; then PLAYLIST="$1"
      else echo "unexpected arg: $1" >&2; usage 1; fi
      shift;;
  esac
done

[ -n "$SRC" ]      || { echo "error: <source-video> required" >&2; usage 1; }
[ -n "$PLAYLIST" ] || { echo "error: <playlist folder> required" >&2; usage 1; }
[ -f "$SRC" ]      || die "not a file: $SRC"
[ -r "$SRC" ]      || die "not readable: $SRC"

command -v ffmpeg  >/dev/null 2>&1 || die "ffmpeg not found on PATH"
command -v ffprobe >/dev/null 2>&1 || die "ffprobe not found on PATH"
command -v perl    >/dev/null 2>&1 || die "perl not found on PATH"

PLAYLIST_SAFE=$(sanitize_component "$PLAYLIST")
[ -n "$PLAYLIST_SAFE" ] || die "playlist folder name is empty after sanitizing: '$PLAYLIST'"

[ -n "$TITLE" ] || TITLE=$(derive_title "$(basename -- "$SRC")")
TITLE_SAFE=$(sanitize_component "$TITLE")
[ -n "$TITLE_SAFE" ] || die "could not derive a title from '$SRC' — pass --title \"Title (Year)\""

# resolve the source to an absolute path (rel-path staging math depends on it)
case "$SRC" in /*) SRC_ABS="$SRC";; *) SRC_ABS="$(cd "$(dirname -- "$SRC")" && pwd)/$(basename -- "$SRC")";; esac

DEST_DIR="$OUTBOX/$PLAYLIST_SAFE/$TITLE_SAFE"
DEST="$DEST_DIR/$TITLE_SAFE.mp4"

# =============================================================================
# CLASSIFY
# =============================================================================
src_ext=$(ext_of "$SRC_ABS")
src_v=$(probe_vcodec "$SRC_ABS")
src_a=$(probe_acodec "$SRC_ABS")
src_dur=$(probe_duration "$SRC_ABS")
src_h=$(probe_height "$SRC_ABS")
src_w=$(probe_width "$SRC_ABS")
src_sz=$(file_size "$SRC_ABS")

[ -n "$src_v" ] || die "no video stream found in $SRC_ABS (ffprobe saw nothing)"

good_video=0; good_audio=0; oversize=0
printf '%s' "$src_v" | grep -Eq "$GOOD_VIDEO_RE" && good_video=1
if [ -z "$src_a" ]; then good_audio=1; else printf '%s' "$src_a" | grep -Eq "$GOOD_AUDIO_RE" && good_audio=1; fi
if [ -n "$src_h" ] && [ "$src_h" -gt 1080 ] 2>/dev/null; then oversize=1; fi
if [ -n "$src_w" ] && [ "$src_w" -gt 1920 ] 2>/dev/null; then oversize=1; fi

if [ "$good_video" -eq 1 ] && [ "$good_audio" -eq 1 ] && [ "$oversize" -eq 0 ]; then
  # A compliant .mp4 is only a straight copy when it is ALSO +faststart;
  # otherwise a stream-copy remux relocates the moov box for free.
  if [ "$src_ext" = "mp4" ] && has_faststart "$SRC_ABS"; then MODE="COPY"; else MODE="REMUX"; fi
else
  MODE="TRANSCODE"
fi

if [ "$MODE" = "TRANSCODE" ] && [ "$NO_NORMALIZE" -eq 1 ]; then
  reason=""
  [ "$good_video" -eq 0 ] && reason="$reason video=$src_v"
  [ "$good_audio" -eq 0 ] && reason="$reason audio=$src_a"
  [ "$oversize"   -eq 1 ] && reason="$reason ${src_w}x${src_h}>1080p"
  die "--no-normalize given but this source needs a re-encode:$reason"
fi

# choose an encoder the same way normalize-media-library.sh does
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'h264_videotoolbox'; then
  VENC_KIND="vt";   VENC_LABEL="h264_videotoolbox (hardware)"
else
  VENC_KIND="x264"; VENC_LABEL="libx264 -preset fast -crf 20 (software fallback)"
fi

# ---- subliminal discovery (optional) ----------------------------------------
SUBLIMINAL=""
if [ -n "${BUNKER_SUBLIMINAL:-}" ] && [ -x "$BUNKER_SUBLIMINAL" ]; then
  SUBLIMINAL="$BUNKER_SUBLIMINAL"
elif command -v subliminal >/dev/null 2>&1; then
  SUBLIMINAL="$(command -v subliminal)"
else
  for c in "$HOME"/Library/Python/*/bin/subliminal "$HOME"/.local/bin/subliminal; do
    [ -x "$c" ] && { SUBLIMINAL="$c"; break; }
  done
fi

# =============================================================================
# PLAN
# =============================================================================
echo "==============================================================="
echo " BUNKER MEDIA COURIER — prepare + queue"
echo "==============================================================="
printf '  source     : %s\n' "$SRC_ABS"
printf '               %s / %s, %sx%s, %s, %s\n' \
  "${src_v:-?}" "${src_a:-none}" "${src_w:-?}" "${src_h:-?}" "$(secs_to_h "$src_dur")" "$(bytes_to_h "$src_sz")"
printf '  playlist   : %s\n' "$PLAYLIST_SAFE"
printf '  title      : %s\n' "$TITLE_SAFE"
printf '  destination: %s\n' "$DEST"
printf '  action     : %s%s\n' "$MODE" "$([ "$MODE" = TRANSCODE ] && printf ' (%s)' "$VENC_LABEL")"
printf '  subtitles  : %s\n' "$([ -n "$SUBLIMINAL" ] && echo "subliminal ($SUBLIMINAL)" || echo "SKIPPED (subliminal not installed)")"
[ -e "$DEST" ] && printf '  note       : destination EXISTS — this is a REPLACEMENT (same path overwrites at the bar)\n'
echo "==============================================================="

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN — nothing written. Re-run without --dry-run to execute."
  exit 0
fi

# =============================================================================
# STAGE + BUILD
# =============================================================================
# Staging lives NEXT TO the outbox (same filesystem => rename(2) is atomic) but
# OUTSIDE it, so Syncthing never indexes a partial file.
STAGING="$(dirname -- "$OUTBOX")/.bunker-courier-staging"
mkdir -p "$STAGING" || die "cannot create staging dir: $STAGING"
mkdir -p "$DEST_DIR" || die "cannot create destination dir: $DEST_DIR"

TMP="$STAGING/$$.$(date +%s).courier.mp4"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

# verify_output <file> <expect-h264:0|1> -> echoes "" on success, a reason on failure
verify_output() {
  local f="$1" want_h264="$2" ov oa od osz
  [ -f "$f" ] || { echo "no-output"; return; }
  ov=$(probe_vcodec "$f"); oa=$(probe_acodec "$f"); od=$(probe_duration "$f"); osz=$(file_size "$f")

  if [ "$want_h264" -eq 1 ]; then
    [ "$ov" = "h264" ] || { echo "bad-vcodec:$ov"; return; }
  else
    printf '%s' "$ov" | grep -Eq "$GOOD_VIDEO_RE" || { echo "bad-vcodec:$ov"; return; }
  fi
  if [ -n "$oa" ]; then
    printf '%s' "$oa" | grep -Eq "$GOOD_AUDIO_RE" || { echo "bad-acodec:$oa"; return; }
  fi
  [ "$osz" -gt "$SIZE_FLOOR" ] || { echo "too-small:${osz}b"; return; }
  has_faststart "$f" || { echo "not-faststart"; return; }

  # duration parity: within max(5s, 3% of source). The burn's truncation lesson.
  local ok
  ok=$(awk -v s="$src_dur" -v o="$od" 'BEGIN{
    if (o+0 <= 0) { print 0; exit }
    if (s+0 <= 0) { print 1; exit }
    tol = s*0.03; if (tol < 5) tol = 5;
    d = s - o; if (d < 0) d = -d;
    print (d <= tol) ? 1 : 0;
  }')
  [ "$ok" = "1" ] || { echo "dur-mismatch:src=${src_dur}:out=${od}"; return; }
  echo ""
}

do_copy() {
  cp -- "$SRC_ABS" "$TMP"
}

do_remux() {
  local cmd=(ffmpeg -y -nostdin -loglevel error -i "$SRC_ABS" -map 0:v:0)
  [ -n "$src_a" ] && cmd+=(-map 0:a:0)
  cmd+=(-c copy -movflags +faststart "$TMP")
  "${cmd[@]}"
}

do_transcode() {
  local cmd=(ffmpeg -y -nostdin -loglevel error -i "$SRC_ABS" -map 0:v:0)
  [ -n "$src_a" ] && cmd+=(-map 0:a:0)
  if [ "$VENC_KIND" = "vt" ]; then
    cmd+=(-c:v h264_videotoolbox -b:v 6000k)
  else
    cmd+=(-c:v libx264 -preset fast -crf 20)
  fi
  cmd+=(-vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2" -pix_fmt yuv420p)
  [ -n "$src_a" ] && cmd+=(-c:a aac -b:a 192k -ac 2)
  cmd+=(-movflags +faststart "$TMP")
  "${cmd[@]}"
}

start=$(date +%s)
ACTION="$MODE"
FALLBACK_NOTE=""

run_stage() {
  case "$1" in
    COPY)      echo "  -> copying (already a compliant .mp4)..."; do_copy;;
    REMUX)     echo "  -> remuxing to .mp4 (stream copy, no re-encode)...";  do_remux;;
    TRANSCODE) echo "  -> transcoding to H.264/AAC <=1080p — this takes a while..."; do_transcode;;
  esac
}

echo
run_stage "$ACTION"
rc=$?

want_h264=0; [ "$ACTION" = "TRANSCODE" ] && want_h264=1
VERDICT="failed-rc-$rc"
[ "$rc" -eq 0 ] && VERDICT=$(verify_output "$TMP" "$want_h264")

# A copy/remux that doesn't verify falls back to a real transcode.
if [ -n "$VERDICT" ] && [ "$ACTION" != "TRANSCODE" ]; then
  if [ "$NO_NORMALIZE" -eq 1 ]; then
    die "$ACTION failed verification ($VERDICT) and --no-normalize forbids a re-encode"
  fi
  FALLBACK_NOTE="$ACTION failed verification ($VERDICT) — fell back to a full transcode"
  echo "  !! $FALLBACK_NOTE"
  rm -f "$TMP"
  ACTION="TRANSCODE"
  run_stage TRANSCODE
  rc=$?
  VERDICT="failed-rc-$rc"
  [ "$rc" -eq 0 ] && VERDICT=$(verify_output "$TMP" 1)
fi

[ -z "$VERDICT" ] || die "output failed verification: $VERDICT (nothing was written to the outbox)"

out_dur=$(probe_duration "$TMP")
out_sz=$(file_size "$TMP")
out_v=$(probe_vcodec "$TMP"); out_a=$(probe_acodec "$TMP")

# ---- atomic move into the outbox -------------------------------------------
mv -f "$TMP" "$DEST" || die "could not move the finished file into the outbox: $DEST"
trap - EXIT
elapsed=$(( $(date +%s) - start ))

# =============================================================================
# SUBTITLES (optional, never fatal)
# =============================================================================
SUB_RESULT="skipped (subliminal not installed — see the runbook)"
if [ -n "$SUBLIMINAL" ]; then
  echo
  echo "  -> fetching an English subtitle (min-score $SUB_MIN_SCORE)..."
  # -F srt   subliminal otherwise SAVES THE PROVIDER'S NATIVE FORMAT (.mpl/.sub/
  #          .ssa were observed). apps/media-shell only reads `.srt` sidecars
  #          (SUBTITLE_EXTENSION in src/constants.js), so anything else is dead
  #          weight shipped to the bar. Force SRT.
  # -m N     subliminal happily downloads a COMPLETELY UNRELATED subtitle for a
  #          title it can't find (measured: a made-up title pulled a real film's
  #          subs at min-score 0-30). 50 accepted a genuine title+year match and
  #          rejected the fabricated one in testing.
  # -W       skip subtitles whose FPS disagrees with the video (drift guard).
  "$SUBLIMINAL" download -l en -m "$SUB_MIN_SCORE" -F srt -W "$DEST" >/dev/null 2>&1 || true
  found=""
  for s in "$DEST_DIR/$TITLE_SAFE.srt" "$DEST_DIR/$TITLE_SAFE".*.srt; do
    [ -f "$s" ] && { found="$s"; break; }
  done
  if [ -n "$found" ]; then
    SUB_RESULT="downloaded: $(basename -- "$found")"
  else
    SUB_RESULT="none found (the film plays fine without one; drop an .srt beside it later)"
  fi
  # Sweep any non-.srt subtitle the provider still managed to leave behind —
  # the shell can't read it and it would only clutter the bar library.
  for junk in "$DEST_DIR/$TITLE_SAFE".*.mpl "$DEST_DIR/$TITLE_SAFE".*.sub \
              "$DEST_DIR/$TITLE_SAFE".*.ssa "$DEST_DIR/$TITLE_SAFE".*.ass \
              "$DEST_DIR/$TITLE_SAFE".*.vtt; do
    [ -f "$junk" ] && rm -f "$junk"
  done
fi

# =============================================================================
# SUMMARY
# =============================================================================
echo
echo "==============================================================="
echo " QUEUED FOR THE BAR"
echo "==============================================================="
printf '  file      : %s\n' "$DEST"
printf '  action    : %s%s\n' "$ACTION" "$([ -n "$FALLBACK_NOTE" ] && printf ' (%s)' "$FALLBACK_NOTE")"
printf '  output    : %s / %s, %s, %s  (%ss)\n' "${out_v:-?}" "${out_a:-none}" "$(secs_to_h "$out_dur")" "$(bytes_to_h "$out_sz")" "$elapsed"
printf '  duration  : source %s -> output %s  [PARITY OK]\n' "$(secs_to_h "$src_dur")" "$(secs_to_h "$out_dur")"
printf '  subtitles : %s\n' "$SUB_RESULT"
printf '  playlist  : %s\n' "$PLAYLIST_SAFE"
echo "---------------------------------------------------------------"
echo "  Syncthing ships this to the bar automatically (watch delay ~10s)."
echo "  Once the Syncthing UI shows the folder Up to Date / 100%, this"
echo "  local copy may be DELETED — deletes never propagate to the bar"
echo "  (the PC folder runs ignoreDelete=true)."
echo "==============================================================="
