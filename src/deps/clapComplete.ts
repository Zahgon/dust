/**
 * `clap_complete` — the five shell completion scripts `build.rs` regenerates on
 * every build, reimplemented over the same command definition.
 *
 * Every generator is a fixed template around one loop, and each shell needs its
 * own quoting: fish backslash-escapes, zsh escapes `: [ ] $ \` and doubles
 * quotes the Bourne way, elvish and PowerShell double the apostrophe, and
 * PowerShell additionally pads an upper-case short flag with a trailing space so
 * its case-insensitive matcher can tell `-T` from `-t`.
 *
 * The committed scripts in `completions/` are the fixture these are checked
 * against: regenerating must leave them byte for byte unchanged.
 */

import type { ArgSpec, CommandSpec } from './clap.ts';

/** Options that take a value, in declaration order. */
function valued(spec: CommandSpec): ArgSpec[] {
  return spec.args.filter((arg) => arg.valueName !== undefined);
}

/** Options that are bare flags, in declaration order. */
function flags(spec: CommandSpec): ArgSpec[] {
  return spec.args.filter((arg) => arg.valueName === undefined);
}

function helpArg(): ArgSpec {
  return { id: 'help', short: 'h', long: 'help', help: "Print help (see more with '--help')" };
}

function versionArg(): ArgSpec {
  return { id: 'version', short: 'V', long: 'version', help: 'Print version' };
}

/** The order the shells list arguments in: valued options, flags, then help and version. */
function completionOrder(spec: CommandSpec): ArgSpec[] {
  return [...valued(spec), ...flags(spec), helpArg(), versionArg()];
}

function findById(spec: CommandSpec, id: string): ArgSpec {
  const arg = spec.args.find((candidate) => candidate.id === id);
  if (arg === undefined) throw new Error(`unknown argument id ${id}`);
  return arg;
}

/* -------------------------------------------------------------------------- */
/* fish                                                                        */

function fishEscape(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function generateFish(spec: CommandSpec): string {
  const lines: string[] = [];
  for (const arg of completionOrder(spec)) {
    let line = `complete -c ${spec.binName}`;
    if (arg.short !== undefined) line += ` -s ${arg.short}`;
    line += ` -l ${arg.long}`;
    line += ` -d '${fishEscape(arg.help)}'`;
    if (arg.valueName !== undefined) {
      line += ' -r';
      if (arg.possibleValues !== undefined) {
        const items = arg.possibleValues
          .map((value) => `${value.name}\\t'${fishEscape(value.help)}'`)
          .join('\n');
        line += ` -f -a "${items}"`;
      } else if (arg.valueHint !== undefined) {
        line += ' -F';
      }
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */
/* zsh                                                                         */

function zshEscape(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll(':', '\\:')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`')
    .replaceAll("'", "'\\''");
}

/** The `(-e --filter -t --file-types)` prefix listing an argument's declared conflicts. */
function zshConflicts(spec: CommandSpec, arg: ArgSpec): string {
  const conflicts = arg.conflictsWith ?? [];
  if (conflicts.length === 0) return '';
  const names: string[] = [];
  for (const id of conflicts) {
    const other = findById(spec, id);
    if (other.short !== undefined) names.push(`-${other.short}`);
    names.push(`--${other.long}`);
  }
  return `(${names.join(' ')})`;
}

function zshAction(arg: ArgSpec): string {
  if (arg.possibleValues !== undefined) {
    const items = arg.possibleValues
      .map((value) => `${value.name}\\:"${value.help}"`)
      .join('\n');
    return `((${items}))`;
  }
  return arg.valueHint !== undefined ? '_files' : '_default';
}

export function generateZsh(spec: CommandSpec): string {
  const name = spec.binName;
  const entries: string[] = [];

  for (const arg of completionOrder(spec)) {
    const prefix = zshConflicts(spec, arg);
    const repeat = arg.multiple === true ? '*' : '';
    const help = zshEscape(arg.help);
    if (arg.valueName !== undefined) {
      const action = zshAction(arg);
      if (arg.short !== undefined) {
        entries.push(`'${prefix}${repeat}-${arg.short}+[${help}]:${arg.valueName}:${action}'`);
      }
      entries.push(`'${prefix}${repeat}--${arg.long}=[${help}]:${arg.valueName}:${action}'`);
    } else {
      if (arg.short !== undefined) entries.push(`'${prefix}-${arg.short}[${help}]'`);
      entries.push(`'${prefix}--${arg.long}[${help}]'`);
    }
  }
  entries.push(
    `'*::${spec.positional.id} -- ${zshEscape(spec.positional.help)}:${
      spec.positional.valueHint !== undefined ? '_files' : '_default'
    }'`,
  );

  return `#compdef ${name}

autoload -U is-at-least

_${name}() {
    typeset -A opt_args
    typeset -a _arguments_options
    local ret=1

    if is-at-least 5.2; then
        _arguments_options=(-s -S -C)
    else
        _arguments_options=(-s -C)
    fi

    local context curcontext="$curcontext" state line
    _arguments "\${_arguments_options[@]}" : \\
${entries.map((entry) => `${entry} \\`).join('\n')}
&& ret=0
}

(( $+functions[_${name}_commands] )) ||
_${name}_commands() {
    local commands; commands=()
    _describe -t commands '${name} commands' commands "$@"
}

if [ "$funcstack[1]" = "_${name}" ]; then
    _${name} "$@"
else
    compdef _${name} ${name}
fi
`;
}

/* -------------------------------------------------------------------------- */
/* elvish and PowerShell                                                       */

function doubleQuoteEscape(text: string): string {
  return text.replaceAll("'", "''");
}

export function generateElvish(spec: CommandSpec): string {
  const name = spec.binName;
  const candidates = completionOrder(spec)
    .flatMap((arg) => {
      const help = doubleQuoteEscape(arg.help);
      const rows: string[] = [];
      if (arg.short !== undefined) rows.push(`            cand -${arg.short} '${help}'`);
      rows.push(`            cand --${arg.long} '${help}'`);
      return rows;
    })
    .join('\n');

  return `
use builtin;
use str;

set edit:completion:arg-completer[${name}] = {|@words|
    fn spaces {|n|
        builtin:repeat $n ' ' | str:join ''
    }
    fn cand {|text desc|
        edit:complex-candidate $text &display=$text' '(spaces (- 14 (wcswidth $text)))$desc
    }
    var command = '${name}'
    for word $words[1..-1] {
        if (str:has-prefix $word '-') {
            break
        }
        set command = $command';'$word
    }
    var completions = [
        &'${name}'= {
${candidates}
        }
    ]
    $completions[$command]
}
`;
}

export function generatePowerShell(spec: CommandSpec): string {
  const name = spec.binName;
  const rows = completionOrder(spec)
    .flatMap((arg) => {
      const help = doubleQuoteEscape(arg.help);
      const out: string[] = [];
      if (arg.short !== undefined) {
        // PowerShell matches case-insensitively, so an upper-case short flag is
        // padded to keep it distinct from its lower-case sibling.
        const listItem = arg.short === arg.short.toUpperCase() ? `-${arg.short} ` : `-${arg.short}`;
        out.push(
          `            [CompletionResult]::new('-${arg.short}', '${listItem}', [CompletionResultType]::ParameterName, '${help}')`,
        );
      }
      out.push(
        `            [CompletionResult]::new('--${arg.long}', '--${arg.long}', [CompletionResultType]::ParameterName, '${help}')`,
      );
      return out;
    })
    .join('\n');

  return `
using namespace System.Management.Automation
using namespace System.Management.Automation.Language

Register-ArgumentCompleter -Native -CommandName '${name}' -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commandElements = $commandAst.CommandElements
    $command = @(
        '${name}'
        for ($i = 1; $i -lt $commandElements.Count; $i++) {
            $element = $commandElements[$i]
            if ($element -isnot [StringConstantExpressionAst] -or
                $element.StringConstantType -ne [StringConstantType]::BareWord -or
                $element.Value.StartsWith('-') -or
                $element.Value -eq $wordToComplete) {
                break
        }
        $element.Value
    }) -join ';'

    $completions = @(switch ($command) {
        '${name}' {
${rows}
            break
        }
    })

    $completions.Where{ $_.CompletionText -like "$wordToComplete*" } |
        Sort-Object -Property ListItemText
}
`;
}

/* -------------------------------------------------------------------------- */
/* bash                                                                        */

const BASH_FILENAMES_BODY = `                    local oldifs
                    if [ -n "\${IFS+x}" ]; then
                        oldifs="$IFS"
                    fi
                    IFS=$'\\n'
                    COMPREPLY=($(compgen -f "\${cur}"))
                    if [ -n "\${oldifs+x}" ]; then
                        IFS="$oldifs"
                    fi
                    if [[ "\${BASH_VERSINFO[0]}" -ge 4 ]]; then
                        compopt -o filenames
                    fi
                    return 0
                    ;;`;

const BASH_DEFAULT_BODY = `                    COMPREPLY=($(compgen -f "\${cur}"))
                    return 0
                    ;;`;

export function generateBash(spec: CommandSpec): string {
  const name = spec.binName;
  // `opts` lists every argument in *declaration* order, unlike the `case` arms
  // below, which follow the valued-then-flags order the other shells use.
  const declared = [...spec.args, helpArg(), versionArg()];

  const shorts = declared.filter((arg) => arg.short !== undefined).map((arg) => `-${arg.short}`);
  const longs = declared.map((arg) => `--${arg.long}`);
  const opts = [...shorts, ...longs].join(' ');

  const arms: string[] = [];
  for (const arg of valued(spec)) {
    const body =
      arg.possibleValues !== undefined
        ? `                    COMPREPLY=($(compgen -W "${arg.possibleValues
            .map((value) => value.name)
            .join(' ')}" -- "\${cur}"))\n                    return 0\n                    ;;`
        : arg.valueHint === 'FilePath'
          ? BASH_FILENAMES_BODY
          : BASH_DEFAULT_BODY;
    arms.push(`                --${arg.long})\n${body}`);
    if (arg.short !== undefined) arms.push(`                -${arg.short})\n${body}`);
  }

  return `_${name}() {
    local i cur prev opts cmd
    COMPREPLY=()
    if [[ "\${BASH_VERSINFO[0]}" -ge 4 ]]; then
        cur="$2"
    else
        cur="\${COMP_WORDS[COMP_CWORD]}"
    fi
    prev="$3"
    cmd=""
    opts=""

    for i in "\${COMP_WORDS[@]:0:COMP_CWORD}"
    do
        case "\${cmd},\${i}" in
            ",$1")
                cmd="${name}"
                ;;
            *)
                ;;
        esac
    done

    case "\${cmd}" in
        ${name})
            opts="${opts}"
            if [[ \${cur} == -* || \${COMP_CWORD} -eq 1 ]] ; then
                COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
                return 0
            fi
            case "\${prev}" in
${arms.join('\n')}
                *)
                    COMPREPLY=()
                    ;;
            esac
            COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
            return 0
            ;;
    esac
}

if [[ "\${BASH_VERSINFO[0]}" -eq 4 && "\${BASH_VERSINFO[1]}" -ge 4 || "\${BASH_VERSINFO[0]}" -gt 4 ]]; then
    complete -F _${name} -o nosort -o bashdefault -o default ${name}
else
    complete -F _${name} -o bashdefault -o default ${name}
fi
`;
}

export const GENERATORS: Record<string, (spec: CommandSpec) => string> = {
  'dust.bash': generateBash,
  _dust: generateZsh,
  'dust.fish': generateFish,
  '_dust.ps1': generatePowerShell,
  'dust.elv': generateElvish,
};
