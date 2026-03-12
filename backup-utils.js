const fs = require('fs');
const path = require('path');

function buildBackupMetadata(appVersion, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return {
    schema: 'crb-backup-v1',
    appVersion: appVersion || 'unknown',
    exportedAt: date.toISOString(),
  };
}

function hasContactsFile(directoryPath) {
  return fs.existsSync(path.join(directoryPath, 'contacts_data.json'));
}

function findBackupPayloadRoot(extractedRoot, maxDepth = 3) {
  if (!extractedRoot || !fs.existsSync(extractedRoot)) return null;
  if (hasContactsFile(extractedRoot)) return extractedRoot;

  const queue = [{ dir: extractedRoot, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current.dir, entry.name);
      if (hasContactsFile(fullPath)) return fullPath;
      queue.push({ dir: fullPath, depth: current.depth + 1 });
    }
  }

  return null;
}

function validateBackupPayload(payloadRoot) {
  if (!payloadRoot) {
    return { valid: false, error: 'Backup payload root not found' };
  }

  const contactsPath = path.join(payloadRoot, 'contacts_data.json');
  if (!fs.existsSync(contactsPath)) {
    return { valid: false, error: 'Backup is missing contacts_data.json' };
  }

  const pdfsPath = path.join(payloadRoot, 'PDFs');
  const metadataPath = path.join(payloadRoot, 'backup-metadata.json');
  return {
    valid: true,
    contactsPath,
    pdfsPath: fs.existsSync(pdfsPath) ? pdfsPath : null,
    metadataPath: fs.existsSync(metadataPath) ? metadataPath : null,
  };
}

module.exports = {
  buildBackupMetadata,
  findBackupPayloadRoot,
  validateBackupPayload,
};
