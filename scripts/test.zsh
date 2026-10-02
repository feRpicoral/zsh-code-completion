#!/usr/bin/env zsh
# Runs the completion in a real interactive zsh and checks what it offers.
# Usage: scripts/test.zsh

emulate -L zsh
zmodload zsh/zpty zsh/datetime || exit 1

local -i COMPLETION_TIMEOUT_SECONDS=60
local root=${0:A:h:h}
export CODE_COMPLETION_DIR=$root
export CODE_TEST_TMP=$(mktemp -d)
export CODE_TEST_OUT=$CODE_TEST_TMP/candidates
trap 'rm -rf $CODE_TEST_TMP' EXIT

local -a candidates
local -i failures=0
local project=$CODE_TEST_TMP/project
mkdir -p $project/app
touch $project/notes.md

candidates_for() {
  local line
  local -F deadline=$(( EPOCHREALTIME + COMPLETION_TIMEOUT_SECONDS ))
  rm -f $CODE_TEST_OUT
  (
    cd $project
    zpty code_test zsh -f -i
    zpty -w code_test "source $root/scripts/tests/capture.zsh"
    until [[ $line == ready* ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t code_test line || sleep 0.01
    done
    zpty -w -n code_test "$1"$'\t'
    # zpty does not report the shell exiting, so the output file appearing marks the end. The pty
    # is drained meanwhile because the shell blocks once its output buffer is full.
    until [[ -e $CODE_TEST_OUT ]] || (( EPOCHREALTIME > deadline )); do
      zpty -r -t code_test line || sleep 0.01
    done
    zpty -d code_test
  )
  if [[ ! -e $CODE_TEST_OUT ]]; then
    print -r -- "FAIL  '$1' did not finish completing within ${COMPLETION_TIMEOUT_SECONDS}s"
    exit 1
  fi
  candidates=("${(@f)$(<$CODE_TEST_OUT)}")
}

fail() {
  print -r -- "FAIL  $1"
  (( failures++ ))
}

offers() {
  local line=$1 expected
  shift
  candidates_for $line
  for expected in $@; do
    if (( ! $candidates[(Ie)$expected] )); then
      fail "'$line' should offer '$expected', got: $candidates"
      return
    fi
  done
  print -r -- "ok    '$line' offers $@"
}

offers_only() {
  local line=$1
  shift
  candidates_for $line
  if [[ ${(j: :)${(ou)candidates}} != ${(j: :)${(ou)@}} ]]; then
    fail "'$line' should offer exactly '$@', got: $candidates"
    return
  fi
  print -r -- "ok    '$line' offers only $@"
}

never_offers() {
  local line=$1 unexpected
  shift
  candidates_for $line
  for unexpected in $@; do
    if (( $candidates[(Ie)$unexpected] )); then
      fail "'$line' should not offer '$unexpected'"
      return
    fi
  done
  print -r -- "ok    '$line' does not offer $@"
}

if zsh -n $root/_code; then
  print -r -- "ok    _code parses"
else
  fail "_code has syntax errors"
fi

local pinned=$(<$root/code-version)
if [[ $(<$root/_code) == *"Visual Studio Code $pinned."* ]]; then
  print -r -- "ok    _code was generated from code $pinned"
else
  fail "_code was not generated from the version in code-version ($pinned)"
fi

offers 'code ' chat tunnel app notes.md
offers 'code app ' notes.md
never_offers 'code app ' chat tunnel
offers 'code --' --diff --install-extension --profile
offers 'code --locale en chat --' --mode --add-file
never_offers 'code chat --' --diff
offers 'code tunnel ' status user service
offers 'code tunnel user ' login logout show
offers 'code tunnel service ' install uninstall log
offers 'code agent ' host ps logs
never_offers 'code tunnel --' --diff
offers_only 'code --sync ' on off
offers_only 'code --add ' app
offers 'code --log ' trace debug
offers 'code tunnel --log ' trace debug
offers 'code chat --mode ' ask edit agent
offers_only 'code --uninstall-extension ' publisher.one publisher.two

candidates_for 'code-sweep '
if (( $#candidates == 1 )) && [[ $candidates[1] == 'swept '<10->' command paths' ]]; then
  print -r -- "ok    $candidates[1], each offering exactly its declared options"
else
  fail "option sweep: ${(F)candidates}"
fi

if (( failures )); then
  print -r -- "$failures failed"
  exit 1
fi
print -r -- "all passed"
