/** `thousands::Separable::separate_with_commas` for the `--filecount` column. */
export function separateWithCommas(value: number): string {
  const digits = value.toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}
