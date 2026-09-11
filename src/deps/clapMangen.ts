/**
 * `clap_mangen` — the roff man page `build.rs` regenerates alongside the
 * completions.
 *
 * roff needs three characters escaped: a backslash, a hyphen (so it is not
 * typeset as a soft hyphen) and an apostrophe, which becomes the `\*(Aq` string
 * the header defines so the page renders correctly under both groff and
 * classic troff.
 */

import type { ArgSpec, CommandSpec } from './clap.ts';

function roff(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('-', '\\-').replaceAll("'", '\\*(Aq');
}

function bold(text: string): string {
  return `\\fB${text}\\fR`;
}

function italic(text: string): string {
  return `\\fI${text}\\fR`;
}

/** The `[\fB\-d\fR|\fB\-\-depth\fR]` form the synopsis lists an option in. */
function synopsisEntry(arg: ArgSpec): string {
  const long = bold(roff(`--${arg.long}`));
  if (arg.short === undefined) return `[${long}]`;
  return `[${bold(roff(`-${arg.short}`))}|${long}]`;
}

/** The `\fB\-d\fR, \fB\-\-depth\fR \fI<DEPTH>\fR` heading of an OPTIONS entry. */
function optionHeading(arg: ArgSpec): string {
  const parts: string[] = [];
  if (arg.short !== undefined) parts.push(bold(roff(`-${arg.short}`)));
  parts.push(bold(roff(`--${arg.long}`)));
  let heading = parts.join(', ');
  if (arg.valueName !== undefined) heading += ` ${italic(roff(`<${arg.valueName}>`))}`;
  return heading;
}

export function generateManPage(spec: CommandSpec): string {
  const help: ArgSpec = {
    id: 'help',
    short: 'h',
    long: 'help',
    help: "Print help (see a summary with '-h')",
  };
  const version: ArgSpec = { id: 'version', short: 'V', long: 'version', help: 'Print version' };
  const all = [...spec.args, help, version];

  const synopsis =
    bold(spec.binName) +
    ' ' +
    all.map(synopsisEntry).join(' ') +
    ` [${italic(roff(spec.positional.valueName))}] `;

  const entries: string[] = [];
  for (const arg of all) {
    let entry = `.TP\n${optionHeading(arg)}\n${roff(arg.help)}`;
    if (arg.possibleValues !== undefined) {
      entry += `\n.br\n\n.br\n${italic('Possible values:')}\n.RS 14`;
      for (const value of arg.possibleValues) {
        entry += `\n.IP \\(bu 2\n${roff(`${value.name}: ${value.help}`)}`;
      }
      entry += '\n.RE';
    }
    entries.push(entry);
  }
  entries.push(`.TP\n[${italic(roff(spec.positional.valueName))}]\n${roff(spec.positional.help)}`);

  return (
    `.ie \\n(.g .ds Aq \\(aq\n` +
    `.el .ds Aq '\n` +
    `.TH ${spec.displayName} 1  "${spec.displayName} ${spec.version}" \n` +
    `.SH NAME\n` +
    `${spec.displayName} \\- ${roff(spec.about)}\n` +
    `.SH SYNOPSIS\n` +
    `${synopsis}\n` +
    `.SH DESCRIPTION\n` +
    `${roff(spec.about)}\n` +
    `.SH OPTIONS\n` +
    `${entries.join('\n')}\n` +
    `.SH VERSION\n` +
    `v${spec.version}\n`
  );
}
