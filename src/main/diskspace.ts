import checkDiskSpace from 'check-disk-space'

export async function getDiskSpaceForPath(targetPath: string): Promise<{ freeBytes: number; totalBytes: number }> {
  const p = String(targetPath ?? '').trim()
  if (!p) throw new Error('targetPath is required')

  // check-disk-space accepts any path and resolves the underlying drive/mount.
  const res = await checkDiskSpace(p)
  return {
    freeBytes: Number(res.free ?? 0),
    totalBytes: Number(res.size ?? 0),
  }
}
