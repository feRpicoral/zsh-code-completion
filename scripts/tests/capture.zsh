# Sourced inside the throwaway interactive shell that scripts/test.zsh drives through a pty.
# The first TAB runs one completion, writes every offered candidate to $CODE_TEST_OUT and exits.

PROMPT=
fpath=($CODE_COMPLETION_DIR ${0:A:h} $fpath)
autoload -Uz compinit
compinit -u -d $CODE_TEST_TMP/zcompdump
bindkey '^I' complete-word

typeset -ga code_test_output

# Stands in for `code --list-extensions`, which the completion calls for extension ids.
code() {
  print -l publisher.one publisher.two
}

compadd() {
  # -O, -A and -D only fill arrays for the caller and add no matches.
  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\ * ]]; then
    builtin compadd "$@"
    return
  fi
  local -a hits
  builtin compadd -A hits "$@"
  code_test_output+=($hits)
  builtin compadd "$@"
}

code_test_finish() {
  # The runner treats the file appearing as "done", so it must never see it half written.
  print -rl -- $code_test_output > $CODE_TEST_OUT.partial
  mv $CODE_TEST_OUT.partial $CODE_TEST_OUT
  exit
}
comppostfuncs=(code_test_finish)

print ready
