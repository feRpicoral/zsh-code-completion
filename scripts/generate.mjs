#!/usr/bin/env node
// Usage: node scripts/generate.mjs [path to the code launcher] > _code

import { spawnSync } from 'node:child_process';

const MAX_DESCRIPTION_LENGTH = 120;
const COMMAND_TIMEOUT_MS = 30_000;
const HELP_COMMAND = 'help';
const INSTALLED_EXTENSIONS = '_code_extensions';

// The desktop CLI names its values with free-form placeholders such as <folder> or <ext-id | path>.
const DESKTOP_VALUE_ACTIONS = [
  [/^(file|path\d*|base|result)\b/, '_files'],
  [/^(folder|dir)$/, '_files -/'],
  [/^ext-id \| path$/, '_files -g "*.vsix(-.)"'],
  [/^ext-id$/, INSTALLED_EXTENSIONS],
  [/^on \| off$/, '(on off)'],
];
// The tunnel CLI names them after the option, in upper case.
const TUNNEL_VALUE_ACTIONS = [
  [/FILE$/, '_files'],
  [/(DIR|FOLDER)$/, '_files -/'],
];

const binary = process.argv[2] ?? 'code';

function run(args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(`\`${binary} ${args.join(' ')}\` failed: ${result.error.message}`);
  }
  // The launcher warns that it does not know `--help` for nested tunnel commands, then still
  // hands them to the tunnel CLI, which prints the help.
  return `${result.stdout}${result.stderr}`.replace(/^Warning: .*\n/gm, '');
}

function summarize(text) {
  let summary = text
    .replace(/\s*\[(env|possible values): [^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    const sentence = summary.match(/^(.{20,}?(?<!e\.g|i\.e)[.;])\s+[A-Za-z`]/);
    if (sentence) {
      summary = sentence[1];
    }
  }
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    summary = `${summary.slice(0, MAX_DESCRIPTION_LENGTH).replace(/\s+\S*$/, '')}...`;
  }
  return summary;
}

function actionFor(label, table) {
  return table.find(([pattern]) => pattern.test(label))?.[1] ?? null;
}

function quotedChoices(description) {
  const quoted = [...description.matchAll(/'([a-z][a-z0-9-]*)'/g)].map(match => match[1]);
  const unique = [...new Set(quoted)];
  return unique.length > 1 ? `(${unique.join(' ')})` : null;
}

function isRepeatable(description) {
  return /\(s\)|one or more/i.test(description);
}

function leaf(name, description) {
  return { name, description: summarize(description), options: [], args: [], subcommands: [] };
}

function argumentFrom(placeholder) {
  const name = placeholder.replace(/^[<[]|\.\.\.$/g, '').replace(/[>\]]$/, '').replace(/\.\.\.$/, '');
  return {
    name: name.toLowerCase(),
    required: placeholder.startsWith('<'),
    multiple: placeholder.includes('...'),
    action: /^paths?$/i.test(name) ? '_files' : ' ',
  };
}

// Desktop help: unindented section titles, entries indented two spaces whose description may sit
// a single space after the flags and wraps onto deeper-indented lines.
function parseDesktopHelp(text) {
  const options = [];
  const commands = [];
  let current;
  for (const line of text.split('\n').map(raw => raw.trimEnd())) {
    const option = line.match(/^ {2}(-[\w-]+(?: -{1,2}[\w-]+)*)((?: <[^>]+>)*)\s+(\S.*)$/);
    const command = line.match(/^ {2}([a-z][\w-]*) {2,}(\S.*)$/);
    const continuation = line.match(/^ {4,}(\S.*)$/);
    if (option) {
      current = {
        flags: option[1].split(' '),
        labels: [...option[2].matchAll(/<([^>]+)>/g)].map(match => match[1]),
        description: option[3],
      };
      options.push(current);
    } else if (command) {
      current = { name: command[1], description: command[2] };
      commands.push(current);
    } else if (continuation && current) {
      current.description += ` ${continuation[1]}`;
    } else {
      current = undefined;
    }
  }
  const usage = text.match(/^Usage: .*\[options\](.*)$/m)?.[1] ?? '';
  return {
    options: options.map(option => ({
      flags: option.flags,
      description: option.description,
      repeatable: isRepeatable(option.description),
      values: option.labels.map(label => ({
        label,
        action:
          actionFor(label, DESKTOP_VALUE_ACTIONS) ??
          (option.labels.length === 1 ? quotedChoices(option.description) : null) ??
          ' ',
      })),
    })),
    commands,
    args: (usage.match(/<[^>]+>|\[[^\]]+\]/g) ?? []).map(argumentFrom),
  };
}

// Tunnel CLI help: "Title:" sections. Short entries keep the description on the same line; long
// ones put it on the following, deeper-indented line.
function parseTunnelHelp(text) {
  const options = [];
  const commands = [];
  const args = [];
  let section;
  let pending;
  for (const line of text.split('\n').map(raw => raw.trimEnd())) {
    const header = line.match(/^([A-Za-z][A-Za-z ]*):$/);
    if (header) {
      section = header[1].toLowerCase();
      pending = undefined;
      continue;
    }
    if (section === 'commands') {
      const command = line.match(/^ {2}([\w-]+)(?: {2,}(\S.*))?$/);
      if (command) {
        commands.push({ name: command[1], description: command[2] ?? '' });
      }
    } else if (section === 'arguments') {
      const argument = line.match(/^ {2}(<[^>]+>(?:\.\.\.)?|\[[^\]]+\](?:\.\.\.)?)/);
      if (argument) {
        args.push(argumentFrom(argument[1]));
      }
    } else if (section?.endsWith('options')) {
      const option = line.match(/^ +(?:(-\w), )?(--[\w-]+)(?: <([^>]+)>)?(?: {2,}(\S.*))?$/);
      const continuation = line.match(/^ {8,}(\S.*)$/);
      if (option) {
        pending = {
          flags: [option[1], option[2]].filter(Boolean),
          label: option[3] ?? null,
          description: option[4] ?? '',
        };
        options.push(pending);
      } else if (continuation && pending && !pending.description) {
        pending.description = continuation[1];
      }
    }
  }
  return {
    options: options.map(option => {
      const possible = option.description.match(/\[possible values: ([^\]]+)\]/)?.[1];
      return {
        flags: option.flags,
        description: option.description,
        repeatable: false,
        values:
          option.label === null
            ? []
            : [
                {
                  label: option.label.toLowerCase(),
                  action: possible
                    ? `(${possible.split(', ').join(' ')})`
                    : (actionFor(option.label, TUNNEL_VALUE_ACTIONS) ?? ' '),
                },
              ],
      };
    }),
    commands,
    args,
  };
}

function commandFrom(commandPath, description) {
  const text = run([...commandPath, '--help']);
  const isTunnelCli = /^Usage: code-tunnel /m.test(text);
  const parsed = isTunnelCli ? parseTunnelHelp(text) : parseDesktopHelp(text);
  if (parsed.options.length === 0) {
    throw new Error(`No options found in \`${binary} ${commandPath.join(' ')} --help\``);
  }
  return {
    name: commandPath.at(-1),
    description: summarize(description),
    options: parsed.options,
    args: parsed.args,
    subcommands: parsed.commands.map(command =>
      command.name === HELP_COMMAND
        ? leaf(command.name, command.description)
        : commandFrom([...commandPath, command.name], command.description)
    ),
  };
}

function quote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function optionSpec(option) {
  const description = summarize(option.description);
  const explanation = description
    ? `[${description.replace(/\\/g, '\\\\').replace(/]/g, '\\]')}]`
    : '';
  const values = option.values
    .map(value => `:${value.label.replace(/:/g, '\\:')}:${value.action}`)
    .join('');
  const suffix = option.values.length > 0 ? '=' : '';
  const names = option.flags.map(flag => `${flag}${suffix}`);
  if (names.length === 1) {
    return quote(`${option.repeatable ? '*' : ''}${names[0]}${explanation}${values}`);
  }
  const prefix = option.repeatable ? '*' : `(${option.flags.join(' ')})`;
  return `${quote(prefix)}{${names.join(',')}}${quote(`${explanation}${values}`)}`;
}

function argumentSpec(argument) {
  const label = argument.name.replace(/:/g, '\\:');
  if (argument.multiple) {
    return quote(`*:${label}:${argument.action}`);
  }
  return quote(`${argument.required ? ':' : '::'}${label}:${argument.action}`);
}

function emitNode(node, commandPath, lines) {
  const body = [];
  if (node.subcommands.length > 0) {
    body.push(
      'subs=(',
      ...node.subcommands.map(subcommand => `  ${quote(`${subcommand.name}:${subcommand.description}`)}`),
      ')'
    );
  }
  if (node.options.length > 0) {
    body.push('opts=(', ...node.options.map(option => `  ${optionSpec(option)}`), ')');
  }
  let positionals = node.args.map(argumentSpec);
  if (node.subcommands.length > 0) {
    // Only the root takes its own arguments (paths to open) alongside subcommands.
    positionals = [quote(node.args.some(argument => argument.multiple) ? '*: :->command' : ': :->command')];
  }
  if (positionals.length > 0) {
    body.push(`args=(${positionals.join(' ')})`);
  }

  if (body.length > 0) {
    lines.push(`    ${quote(commandPath)})`, ...body.map(line => `      ${line}`), '      ;;');
  }
  for (const subcommand of node.subcommands) {
    const subcommandPath = commandPath ? `${commandPath} ${subcommand.name}` : subcommand.name;
    emitNode(subcommand, subcommandPath, lines);
  }
}

const version = run(['--version']).split('\n')[0].trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Unexpected \`${binary} --version\` output: ${version}`);
}

const root = commandFrom([], '');
if (root.subcommands.length === 0) {
  throw new Error(`Cannot find the subcommand list in \`${binary} --help\``);
}

const nodeLines = [];
emitNode(root, '', nodeLines);

process.stdout.write(`#compdef code

# Generated from the help output of Visual Studio Code ${version}.

_code_node() {
  subs=() opts=() args=()
  case $1 in
${nodeLines.join('\n')}
  esac
}

${INSTALLED_EXTENSIONS}() {
  local -a extensions
  extensions=(\${(f)"$(_call_program extensions code --list-extensions 2>/dev/null)"})
  _wanted extensions expl 'installed extension' compadd -a extensions
}

_code_load() {
  local spec flag
  _code_node "$node"
  value_flags=()
  for spec in $opts; do
    spec=\${spec#\\(*\\)}
    flag=\${\${spec#\\*}%%[\\[:]*}
    [[ $flag == *= ]] && value_flags+=(\${flag%=})
  done
}

_code() {
  local curcontext=$curcontext state state_descr line node word
  local -a subs opts args value_flags expl
  local -A opt_args
  local -i i=2 start=1 positional=0 ret=1

  _code_load
  while (( i < CURRENT )); do
    word=$words[i]
    if [[ $word == -- ]]; then
      break
    elif [[ $word == -?* ]]; then
      [[ $word != *=* ]] && (( $value_flags[(Ie)$word] )) && (( i++ ))
    elif (( ! positional )); then
      if (( $subs[(I)\${(b)word}:*] )); then
        node="\${node:+$node }$word"
        start=$i
        _code_load
      else
        positional=1
      fi
    fi
    (( i++ ))
  done

  words=($words[1] "\${(@)words[start+1,-1]}")
  (( CURRENT -= start - 1 ))

  _arguments -S -C : $opts $args && ret=0
  if [[ $state == command ]]; then
    if (( ! positional )); then
      _describe -t commands 'code command' subs && ret=0
    fi
    if [[ -z $node ]]; then
      _wanted files expl 'file or folder' _path_files && ret=0
    fi
  fi
  return ret
}

_code "$@"
`);
