/**
 * The two Rust error texts dust prints verbatim.
 *
 * `io::Error` renders an OS error as `{strerror} (os error {errno})`, and
 * `Utf8Error` names the byte offset it gave up at. Node's own messages carry
 * the errno symbol and the syscall instead, so both are rebuilt here rather
 * than passed through.
 */

const STRERROR: Record<string, [number, string]> = {
  EPERM: [1, 'Operation not permitted'],
  ENOENT: [2, 'No such file or directory'],
  ESRCH: [3, 'No such process'],
  EINTR: [4, 'Interrupted system call'],
  EIO: [5, 'Input/output error'],
  ENXIO: [6, 'No such device or address'],
  EBADF: [9, 'Bad file descriptor'],
  EAGAIN: [35, 'Resource temporarily unavailable'],
  ENOMEM: [12, 'Cannot allocate memory'],
  EACCES: [13, 'Permission denied'],
  EFAULT: [14, 'Bad address'],
  EBUSY: [16, 'Resource busy'],
  EEXIST: [17, 'File exists'],
  EXDEV: [18, 'Cross-device link'],
  ENODEV: [19, 'Operation not supported by device'],
  ENOTDIR: [20, 'Not a directory'],
  EISDIR: [21, 'Is a directory'],
  EINVAL: [22, 'Invalid argument'],
  ENFILE: [23, 'Too many open files in system'],
  EMFILE: [24, 'Too many open files'],
  ENOSPC: [28, 'No space left on device'],
  EROFS: [30, 'Read-only file system'],
  EMLINK: [31, 'Too many links'],
  ENAMETOOLONG: [63, 'File name too long'],
  ELOOP: [62, 'Too many levels of symbolic links'],
  ENOTEMPTY: [66, 'Directory not empty'],
};

export function ioErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** `io::Error`'s `Display`. */
export function ioErrorString(error: unknown): string {
  const entry = STRERROR[ioErrorCode(error)];
  if (entry === undefined) return error instanceof Error ? error.message : String(error);
  return `${entry[1]} (os error ${String(entry[0])})`;
}

/** `io::ErrorKind`, as `Debug for io::Error` names it. */
const ERROR_KIND: Record<string, string> = {
  EPERM: 'PermissionDenied',
  ENOENT: 'NotFound',
  EINTR: 'Interrupted',
  EAGAIN: 'WouldBlock',
  ENOMEM: 'OutOfMemory',
  EACCES: 'PermissionDenied',
  EBUSY: 'ResourceBusy',
  EEXIST: 'AlreadyExists',
  EXDEV: 'CrossesDevices',
  ENOTDIR: 'NotADirectory',
  EISDIR: 'IsADirectory',
  EINVAL: 'InvalidInput',
  ENOSPC: 'StorageFull',
  EROFS: 'ReadOnlyFilesystem',
  EMLINK: 'TooManyLinks',
  ENAMETOOLONG: 'InvalidFilename',
  ELOOP: 'FilesystemLoop',
  ENOTEMPTY: 'DirectoryNotEmpty',
};

/** `Debug for io::Error`: `Os { code: 2, kind: NotFound, message: "..." }`. */
export function ioErrorDebug(error: unknown): string {
  const code = ioErrorCode(error);
  const entry = STRERROR[code];
  if (entry === undefined) return error instanceof Error ? error.message : String(error);
  const kind = ERROR_KIND[code] ?? 'Uncategorized';
  return `Os { code: ${String(entry[0])}, kind: ${kind}, message: "${entry[1]}" }`;
}

/** Byte lengths keyed by leading byte, per RFC 3629. 0 marks an invalid lead. */
function leadWidth(byte: number): number {
  if (byte < 0x80) return 1;
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 0;
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/**
 * `std::str::from_utf8`'s `Utf8Error` message, or null when the bytes are
 * valid: either `invalid utf-8 sequence of N bytes from index I` or
 * `incomplete utf-8 byte sequence from index I`.
 */
export function utf8ErrorMessage(bytes: Uint8Array): string | null {
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index] as number;
    const width = leadWidth(first);
    if (width === 0) return `invalid utf-8 sequence of 1 bytes from index ${String(index)}`;
    if (width === 1) {
      index += 1;
      continue;
    }

    const second = bytes[index + 1];
    const secondValid =
      width === 2
        ? isContinuation(second)
        : width === 3
          ? second !== undefined &&
            ((first === 0xe0 && second >= 0xa0 && second <= 0xbf) ||
              (first >= 0xe1 && first <= 0xec && second >= 0x80 && second <= 0xbf) ||
              (first === 0xed && second >= 0x80 && second <= 0x9f) ||
              (first >= 0xee && first <= 0xef && second >= 0x80 && second <= 0xbf))
          : second !== undefined &&
            ((first === 0xf0 && second >= 0x90 && second <= 0xbf) ||
              (first >= 0xf1 && first <= 0xf3 && second >= 0x80 && second <= 0xbf) ||
              (first === 0xf4 && second >= 0x80 && second <= 0x8f));

    if (second === undefined) return `incomplete utf-8 byte sequence from index ${String(index)}`;
    if (!secondValid) return `invalid utf-8 sequence of 1 bytes from index ${String(index)}`;

    for (let offset = 2; offset < width; offset++) {
      const next = bytes[index + offset];
      if (next === undefined) {
        return `incomplete utf-8 byte sequence from index ${String(index)}`;
      }
      if (!isContinuation(next)) {
        return `invalid utf-8 sequence of ${String(offset)} bytes from index ${String(index)}`;
      }
    }
    index += width;
  }
  return null;
}
