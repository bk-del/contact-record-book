const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildBackupMetadata,
  findBackupPayloadRoot,
  validateBackupPayload,
} = require('../backup-utils');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('buildBackupMetadata includes schema, version, and timestamp', () => {
  const metadata = buildBackupMetadata(
    '1.2.3',
    new Date('2026-03-11T12:00:00.000Z'),
  );
  assert.equal(metadata.schema, 'crb-backup-v1');
  assert.equal(metadata.appVersion, '1.2.3');
  assert.equal(metadata.exportedAt, '2026-03-11T12:00:00.000Z');
});

test('findBackupPayloadRoot finds nested payload root containing contacts_data.json', () => {
  const root = makeTempDir('crb-backup-test-');
  try {
    const nested = path.join(root, 'archive', 'payload');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'contacts_data.json'), '[]', 'utf8');

    const found = findBackupPayloadRoot(root);
    assert.equal(found, nested);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('validateBackupPayload rejects missing contacts and accepts valid payload', () => {
  const root = makeTempDir('crb-backup-validate-');
  try {
    const invalid = validateBackupPayload(root);
    assert.equal(invalid.valid, false);

    fs.writeFileSync(path.join(root, 'contacts_data.json'), '[]', 'utf8');
    fs.mkdirSync(path.join(root, 'PDFs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backup-metadata.json'), '{}', 'utf8');

    const valid = validateBackupPayload(root);
    assert.equal(valid.valid, true);
    assert.equal(valid.contactsPath, path.join(root, 'contacts_data.json'));
    assert.equal(valid.pdfsPath, path.join(root, 'PDFs'));
    assert.equal(valid.metadataPath, path.join(root, 'backup-metadata.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
