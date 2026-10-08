/**
 * CodeCollab Export Utility
 * Exports all workspace files cleanly without injected comments or artificial headers.
 * For single files, triggers direct download with its clean workspace name.
 * For multiple files, packages all files into a standard, dependency-free ZIP archive.
 */

export interface WorkspaceExportFile {
  name: string;
  path: string;
  content: string;
  language?: string;
}

interface ExportWorkspaceOptions {
  files: WorkspaceExportFile[];
  roomTitle?: string;
  roomId?: string;
}

// ─────────────────────────────────────────────────────────────
// CRC-32 Table for standard ZIP archive generation
// ─────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates a standard uncompressed (STORE) ZIP archive Blob from file list.
 * 100% dependency-free, compliant with standard ZIP specifications.
 */
function createZipBlob(files: Array<{ name: string; data: Uint8Array }>): Blob {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2) & 0x1f));
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const encoder = new TextEncoder();

  for (const file of files) {
    const filenameBytes = encoder.encode(file.name);
    const fileData = file.data;
    const fileCrc = calculateCrc32(fileData);
    const fileLength = fileData.length;

    // Local Header (30 bytes + name length + data length)
    const localHeader = new Uint8Array(30 + filenameBytes.length + fileLength);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);  // signature
    localView.setUint16(4, 20, true);          // version needed
    localView.setUint16(6, 0x0800, true);      // UTF-8 filename flag
    localView.setUint16(8, 0, true);           // compression (0 = STORE)
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, fileCrc, true);
    localView.setUint32(18, fileLength, true); // compressed size
    localView.setUint32(22, fileLength, true); // uncompressed size
    localView.setUint16(26, filenameBytes.length, true);
    localView.setUint16(28, 0, true);          // extra field length

    localHeader.set(filenameBytes, 30);
    localHeader.set(fileData, 30 + filenameBytes.length);

    // Central Directory Header (46 bytes + name length)
    const centralHeader = new Uint8Array(46 + filenameBytes.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true); // signature
    centralView.setUint16(4, 20, true);         // version made by
    centralView.setUint16(6, 20, true);         // version needed
    centralView.setUint16(8, 0x0800, true);     // flags (UTF-8)
    centralView.setUint16(10, 0, true);         // compression
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, fileCrc, true);
    centralView.setUint32(20, fileLength, true);
    centralView.setUint32(24, fileLength, true);
    centralView.setUint16(28, filenameBytes.length, true);
    centralView.setUint16(30, 0, true);         // extra length
    centralView.setUint16(32, 0, true);         // comment length
    centralView.setUint16(34, 0, true);         // disk number
    centralView.setUint16(36, 0, true);         // internal attrs
    centralView.setUint32(38, 0, true);         // external attrs
    centralView.setUint32(42, offset, true);    // relative offset of local header

    centralHeader.set(filenameBytes, 46);

    localHeaders.push(localHeader);
    centralHeaders.push(centralHeader);

    offset += localHeader.length;
  }

  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  // End of Central Directory Record (22 bytes)
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);      // signature
  endView.setUint16(4, 0, true);               // disk number
  endView.setUint16(6, 0, true);               // central dir disk
  endView.setUint16(8, files.length, true);    // entries on this disk
  endView.setUint16(10, files.length, true);   // total entries
  endView.setUint32(12, centralDirSize, true); // central dir size
  endView.setUint32(16, offset, true);         // offset of central dir
  endView.setUint16(20, 0, true);              // comment length

  const totalParts = [...localHeaders, ...centralHeaders, endRecord];
  return new Blob(totalParts as BlobPart[], { type: "application/zip" });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (document.body.contains(anchor)) {
      document.body.removeChild(anchor);
    }
  }, 200);
}

function sanitizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40) || "workspace";
}

/**
 * Exports all workspace files cleanly without any injected comments.
 * - Single file: downloads the file directly with clean name (e.g. main.cpp).
 * - Multiple files: packages all files in a clean zip archive (e.g. my-project.zip).
 */
export async function exportWorkspaceFiles(opts: ExportWorkspaceOptions): Promise<{ count: number; filename: string }> {
  const { files, roomTitle = "CodeCollab", roomId } = opts;

  if (!files || files.length === 0) {
    throw new Error("No files in workspace to export");
  }

  const encoder = new TextEncoder();
  const folderName = sanitizeName(roomTitle);

  // Single file download directly without packaging as zip
  if (files.length === 1) {
    const single = files[0]!;
    const cleanFilename = single.name || (single.path.split("/").pop() ?? "code.txt");
    const blob = new Blob([single.content], { type: "text/plain;charset=utf-8" });
    triggerDownload(blob, cleanFilename);
    return { count: 1, filename: cleanFilename };
  }

  // Multiple files: clean zip package with raw code (zero comments added)
  const prepared = files.map((f) => {
    const cleanPath = f.path ? f.path.replace(/^\/+/, "") : "";
    const name = cleanPath || f.name || "file.txt";
    return {
      name,
      data: encoder.encode(f.content),
    };
  });

  const zipBlob = createZipBlob(prepared);
  const zipFilename = `${folderName}-workspace-files.zip`;
  triggerDownload(zipBlob, zipFilename);
  return { count: files.length, filename: zipFilename };
}

/**
 * Backward compatibility alias for single file export.
 * Clean export without adding comments.
 */
export function exportCodeFile(opts: {
  code: string;
  language?: string;
  roomId?: string;
  roomTitle?: string;
  authorName?: string;
  filename?: string;
}): void {
  const cleanFilename = opts.filename || "main.cpp";
  const blob = new Blob([opts.code], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, cleanFilename);
}
