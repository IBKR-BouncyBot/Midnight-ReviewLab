/** Download and authenticate the exact official Lace store package for CI.
 * Does not launch a browser, initialize a wallet, or access wallet data.
 * CRX3 signing format and publisher-key pin follow Chromium's crx3.proto and
 * components/crx_file/crx_verifier.cc (RSA PKCS#1 SHA-256 / ECDSA SHA-256).
 */
import { constants, createHash, createPublicKey, createVerify } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

export const LACE_PACKAGE = Object.freeze({
  extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk', version: '2.5.1',
  sha256: 'bff973f7c741ccdbf91c4a1125d4d6da8e9a0b2384b6b1f51c6898b24c87e055', bytes: 73665394,
});
const PUBLISHER_KEY_SHA256 = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';
const HOSTS = new Set(['clients2.google.com', 'clients2.googleusercontent.com']);
const MAX_HEADER = 1_048_576, MAX_FILE = 128 * 1024 * 1024, MAX_TOTAL = 512 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const extensionId = bytes => Buffer.from(bytes).toString('hex').replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
class LacePackageError extends Error { constructor(code) { super(`Official Lace package check failed: ${code}`); this.name = 'LacePackageError'; this.code = code; } }
function requireValue(value, code) { if (!value) throw new LacePackageError(code); }

function fields(bytes) {
  const output = []; let offset = 0;
  const varint = () => {
    let value = 0, shift = 0;
    for (let count = 0; count < 5; count++) {
      requireValue(offset < bytes.length, 'protobuf-bounds'); const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) { requireValue(Number.isSafeInteger(value), 'protobuf-integer'); return value; }
      shift += 7;
    }
    throw new LacePackageError('protobuf-varint');
  };
  while (offset < bytes.length) {
    const tag = varint(), number = Math.floor(tag / 8), type = tag % 8;
    requireValue(number > 0 && output.length < 100, 'protobuf-fields');
    if (type === 2) {
      const length = varint(); requireValue(length <= MAX_HEADER && offset + length <= bytes.length, 'protobuf-length');
      output.push({ number, value: bytes.subarray(offset, offset + length) }); offset += length;
    } else if (type === 0) varint();
    else if (type === 1 || type === 5) { offset += type === 1 ? 8 : 4; requireValue(offset <= bytes.length, 'protobuf-bounds'); }
    else throw new LacePackageError('protobuf-wire-type');
  }
  return output;
}
function one(list, number) {
  const matches = list.filter(field => field.number === number); requireValue(matches.length === 1, 'protobuf-required-field'); return matches[0].value;
}
function verifyCrx(crx) {
  requireValue(crx.length === LACE_PACKAGE.bytes && sha256(crx) === LACE_PACKAGE.sha256, 'pinned-file-hash-or-size');
  requireValue(crx.subarray(0, 4).toString('ascii') === 'Cr24' && crx.readUInt32LE(4) === 3, 'crx3-header');
  const headerSize = crx.readUInt32LE(8); requireValue(headerSize > 0 && headerSize <= MAX_HEADER && 12 + headerSize < crx.length, 'crx3-header-size');
  const header = fields(crx.subarray(12, 12 + headerSize)), signed = one(header, 10000), id = one(fields(signed), 1);
  requireValue(id.length === 16 && extensionId(id) === LACE_PACKAGE.extensionId, 'signed-extension-id');
  const archive = crx.subarray(12 + headerSize), size = Buffer.alloc(4); size.writeUInt32LE(signed.length);
  const proofs = header.filter(field => field.number === 2 || field.number === 3);
  requireValue(proofs.length > 0 && proofs.length <= 16, 'signature-count');
  let developerKey, publisherVerified = false;
  for (const proof of proofs) {
    const data = fields(proof.value), keyBytes = one(data, 1), signature = one(data, 2);
    requireValue(keyBytes.length <= 16384 && signature.length <= 16384, 'signature-size');
    const key = createPublicKey({ key: keyBytes, type: 'spki', format: 'der' });
    requireValue(proof.number === 2 ? key.asymmetricKeyType === 'rsa' : key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1', 'signature-key-type');
    const verifier = createVerify('SHA256');
    verifier.update(Buffer.from('CRX3 SignedData\0')); verifier.update(size); verifier.update(signed); verifier.update(archive); verifier.end();
    requireValue(verifier.verify(proof.number === 2 ? { key, padding: constants.RSA_PKCS1_PADDING } : key, signature), 'crx3-signature');
    const keyHash = sha256(keyBytes);
    if (extensionId(Buffer.from(keyHash, 'hex').subarray(0, 16)) === LACE_PACKAGE.extensionId) developerKey = keyBytes;
    if (keyHash === PUBLISHER_KEY_SHA256) publisherVerified = true;
  }
  requireValue(developerKey && publisherVerified, 'developer-or-store-publisher-proof');
  return { archive, developerKey, evidence: { crxVersion: 3, signaturesVerified: proofs.length,
    developerKeySha256: sha256(developerKey), chromeStorePublisherProofVerified: true, publisherKeySha256: PUBLISHER_KEY_SHA256 } };
}

function zipEntries(zip) {
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65557); offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50 && offset + 22 + zip.readUInt16LE(offset + 20) === zip.length) { end = offset; break; }
  }
  requireValue(end >= 0 && zip.readUInt16LE(end + 4) === 0 && zip.readUInt16LE(end + 6) === 0, 'zip-directory');
  const count = zip.readUInt16LE(end + 10), size = zip.readUInt32LE(end + 12), start = zip.readUInt32LE(end + 16);
  requireValue(count > 0 && count < 10000 && count === zip.readUInt16LE(end + 8) && start + size === end, 'zip-directory-bounds');
  const entries = [], paths = new Set(), intervals = []; let offset = start, total = 0;
  for (let index = 0; index < count; index++) {
    requireValue(offset + 46 <= end && zip.readUInt32LE(offset) === 0x02014b50, 'zip-central-entry');
    const flags = zip.readUInt16LE(offset + 8), method = zip.readUInt16LE(offset + 10), checksum = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20), expanded = zip.readUInt32LE(offset + 24), nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30), comment = zip.readUInt16LE(offset + 32), disk = zip.readUInt16LE(offset + 34);
    const attributes = zip.readUInt32LE(offset + 38), local = zip.readUInt32LE(offset + 42), unixType = (attributes >>> 16) & 0o170000;
    requireValue(offset + 46 + nameLength + extra + comment <= end && nameLength > 0 && nameLength <= 1024, 'zip-name-bounds');
    const nameBytes = zip.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes), directory = name.endsWith('/');
    const parts = name.replace(/\/$/, '').split('/');
    requireValue(!name.includes('\\') && !name.includes(':') && !/[\u0000-\u001f]/.test(name)
      && !name.startsWith('/') && parts.every(part => part && part !== '.' && part !== '..' && !/[ .]$/.test(part)
        && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'zip-unsafe-path');
    const pathKey = parts.join('/').toLowerCase(); requireValue(!paths.has(pathKey), 'zip-duplicate-path'); paths.add(pathKey);
    requireValue(disk === 0 && !(flags & 0x41) && (method === 0 || method === 8)
      && [0, 0o100000, 0o040000].includes(unixType) && (unixType !== 0o040000 || directory)
      && (unixType !== 0o100000 || !directory), 'zip-unsupported-entry');
    total += expanded; requireValue(expanded <= MAX_FILE && total <= MAX_TOTAL && compressed <= LACE_PACKAGE.bytes, 'zip-expanded-size');
    requireValue(local + 30 <= start && zip.readUInt32LE(local) === 0x04034b50
      && zip.readUInt16LE(local + 6) === flags && zip.readUInt16LE(local + 8) === method, 'zip-local-header');
    const localName = zip.readUInt16LE(local + 26), localExtra = zip.readUInt16LE(local + 28), dataStart = local + 30 + localName + localExtra;
    requireValue(localName === nameLength && zip.subarray(local + 30, local + 30 + localName).equals(nameBytes)
      && dataStart + compressed <= start, 'zip-local-bounds');
    if (!(flags & 8)) requireValue(zip.readUInt32LE(local + 14) === checksum && zip.readUInt32LE(local + 18) === compressed && zip.readUInt32LE(local + 22) === expanded, 'zip-local-size');
    intervals.push([local, dataStart + compressed]);
    entries.push({ name: parts.join('/'), directory, method, checksum, compressed, expanded, dataStart });
    offset += 46 + nameLength + extra + comment;
  }
  requireValue(offset === end, 'zip-directory-size');
  intervals.sort((a, b) => a[0] - b[0]);
  requireValue(intervals.every((item, index) => index === 0 || item[0] >= intervals[index - 1][1]), 'zip-overlapping-data');
  const regular = new Set(entries.filter(item => !item.directory).map(item => item.name.toLowerCase()));
  requireValue(entries.every(item => item.name.split('/').slice(0, -1).every((_, index, parts) => !regular.has(parts.slice(0, index + 1).join('/').toLowerCase()))), 'zip-file-as-directory');
  return { entries, total };
}
function unpack(zip, entry) {
  const compressed = zip.subarray(entry.dataStart, entry.dataStart + entry.compressed);
  const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.expanded) });
  requireValue(bytes.length === entry.expanded && crc32(bytes) === entry.checksum && (!entry.directory || bytes.length === 0), 'zip-content-check');
  return bytes;
}
function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([a-zA-Z_][\w:-]*)\s*=\s*(["'])(.*?)\2/g)) {
    requireValue(!Object.hasOwn(result, match[1]), 'update-duplicate-attribute');
    result[match[1]] = match[3].replace(/&(amp|quot|apos|lt|gt);/g, (_, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[name]);
  }
  return result;
}
async function download(url, maximum, signal) {
  let target = new URL(url);
  for (let redirects = 0; redirects <= 4; redirects++) {
    requireValue(target.protocol === 'https:' && HOSTS.has(target.hostname) && !target.username && !target.password && !target.hash, 'download-origin');
    const response = await fetch(target, { redirect: 'manual', credentials: 'omit', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); target = new URL(response.headers.get('location'), target); continue; }
    requireValue(response.ok && response.body, 'download-http-status');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; requireValue(size <= maximum, 'download-size'); chunks.push(chunk); }
    return Buffer.concat(chunks, size);
  }
  throw new LacePackageError('download-redirect-limit');
}

export async function acquireOfficialLace({ outputDirectory } = {}) {
  try {
    requireValue(typeof outputDirectory === 'string' && isAbsolute(outputDirectory), 'absolute-output-directory-required');
    const output = resolve(outputDirectory); await mkdir(output, { recursive: true });
    requireValue(!(await lstat(output)).isSymbolicLink() && (await lstat(output)).isDirectory()
      && (await readdir(output)).length === 0 && await realpath(output) === output, 'fresh-real-empty-directory-required');
    const signal = AbortSignal.timeout(120000);
    const updateUrl = new URL('https://clients2.google.com/service/update2/crx');
    updateUrl.searchParams.set('prodversion', '156.0.8078.4'); updateUrl.searchParams.set('acceptformat', 'crx3');
    updateUrl.searchParams.set('x', `id=${LACE_PACKAGE.extensionId}&uc`);
    const xml = (await download(updateUrl, 65536, signal)).toString('utf8');
    requireValue(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'update-xml-entities');
    const apps = [...xml.matchAll(/<app\b([^>]*)>([\s\S]*?)<\/app>/g)].filter(match => attributes(match[1]).appid === LACE_PACKAGE.extensionId);
    requireValue(apps.length === 1, 'update-extension-id');
    const updates = [...apps[0][2].matchAll(/<updatecheck\b([^>]*)\/?\s*>/g)]; requireValue(updates.length === 1, 'update-response');
    const update = attributes(updates[0][1]);
    requireValue(update.status === 'ok' && update.version === LACE_PACKAGE.version && Number(update.size) === LACE_PACKAGE.bytes
      && update.hash_sha256?.toLowerCase() === LACE_PACKAGE.sha256 && typeof update.codebase === 'string', 'store-version-hash-or-size-changed');
    const crx = await download(update.codebase, LACE_PACKAGE.bytes, signal);
    const verified = verifyCrx(crx), { entries, total } = zipEntries(verified.archive);
    const manifestEntry = entries.find(entry => entry.name === 'manifest.json' && !entry.directory);
    requireValue(manifestEntry && manifestEntry.expanded <= MAX_HEADER, 'manifest-missing');
    const manifestBytes = unpack(verified.archive, manifestEntry), manifest = JSON.parse(manifestBytes);
    requireValue(manifest.version === LACE_PACKAGE.version && manifest.manifest_version === 3
      && manifest.background?.service_worker === './js/sw/sw-script.js' && typeof manifest.key === 'string', 'manifest-identity');
    requireValue(Buffer.from(manifest.key, 'base64').equals(verified.developerKey), 'manifest-developer-key');
    requireValue(entries.some(entry => entry.name === 'offscreen.html'), 'offscreen-prover-page-missing');
    // Validate every file before writing anything. This checks decompression and
    // CRC with strict bounds; archive keys/signatures have already been checked.
    for (const entry of entries) unpack(verified.archive, entry);
    for (const entry of entries) {
      const path = resolve(output, ...entry.name.split('/')), rel = relative(output, path);
      requireValue(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'output-path-escape');
      if (entry.directory) await mkdir(path, { recursive: true });
      else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, unpack(verified.archive, entry), { flag: 'wx', mode: 0o600 }); }
    }
    return { extensionDirectory: output, evidence: { source: 'Chrome Web Store official update service',
      extensionId: LACE_PACKAGE.extensionId, version: LACE_PACKAGE.version, crxSha256: LACE_PACKAGE.sha256, crxBytes: crx.length,
      ...verified.evidence, manifestSha256: sha256(manifestBytes), manifestVersion: 3,
      filesExtracted: entries.filter(entry => !entry.directory).length, expandedBytes: total,
      pathsAndCrcValidated: true, extensionExecuted: false, walletAccess: false,
    } };
  } catch (error) {
    if (error instanceof LacePackageError) throw error;
    throw new LacePackageError('package-acquisition-or-validation-failed');
  }
}
