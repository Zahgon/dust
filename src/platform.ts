import * as fs from 'node:fs';

/**
 * All unix `MetadataExt` implementations define a block as 512 bytes.
 * https://doc.rust-lang.org/std/os/linux/fs/trait.MetadataExt.html#tymethod.st_blocks
 */
function getBlockSize(): bigint {
  return 512n;
}

/** `(inode, device)`, kept as bigints because both are `u64` on the C side. */
export type InodeAndDevice = readonly [bigint, bigint];

/** `(mtime, atime, ctime)` in whole unix seconds. */
export type FileTimes = readonly [number, number, number];

export interface Metadata {
  readonly size: number;
  readonly inodeDevice: InodeAndDevice | null;
  readonly times: FileTimes;
}

/** `st_mtime` and friends: whole seconds, rounding *down* even before the epoch. */
function secondsFromNs(nanoseconds: bigint): number {
  const billion = 1_000_000_000n;
  let seconds = nanoseconds / billion;
  if (nanoseconds % billion !== 0n && nanoseconds < 0n) seconds -= 1n;
  return Number(seconds);
}

export function getMetadata(
  path: string,
  useApparentSize: boolean,
  followLinks: boolean,
): Metadata | null {
  const stat = followLinks
    ? fs.statSync(path, { bigint: true, throwIfNoEntry: false })
    : fs.lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (stat === undefined) return null;

  const times: FileTimes = [
    secondsFromNs(stat.mtimeNs),
    secondsFromNs(stat.atimeNs),
    secondsFromNs(stat.ctimeNs),
  ];
  const inodeDevice: InodeAndDevice = [stat.ino, stat.dev];
  const fileSize = stat.size;

  if (useApparentSize) {
    return { size: Number(fileSize), inodeDevice, times };
  }

  // On NTFS mounts, the reported block count can be unexpectedly large.
  // To avoid overestimating disk usage, cap the allocated size to what the
  // file should occupy based on the file system I/O block size (blksize).
  // Related: https://github.com/bootandy/dust/issues/295
  const blksize = stat.blksize;
  const targetSize = blksize === 0n ? fileSize : ((fileSize + blksize - 1n) / blksize) * blksize;
  const reportedSize = stat.blocks * getBlockSize();

  // File systems can pre-allocate more space for a file than what would be necessary
  const preAllocationBuffer = blksize * 65536n;
  const maxSize = targetSize + preAllocationBuffer;
  const allocatedSize = reportedSize > maxSize ? targetSize : reportedSize;

  return { size: Number(allocatedSize), inodeDevice, times };
}
