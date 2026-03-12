const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildContactPdfFileName,
  clearDeleteState,
  filterActiveContacts,
  filterRecentUpdatedContacts,
  findDuplicateContact,
  hasExpiredPendingDeletion,
  isPendingDeletion,
  markContactSoftDeleted,
  normalizeContactRecord,
  shouldDeleteUpdateFolder,
  toDateStringInTimeZone,
} = require('../contact-utils');

test('buildContactPdfFileName creates collision-free names for different ids', () => {
  const fileA = buildContactPdfFileName('123');
  const fileB = buildContactPdfFileName('456');

  assert.equal(fileA, 'contact_123.pdf');
  assert.equal(fileB, 'contact_456.pdf');
  assert.notEqual(fileA, fileB);
});

test('toDateStringInTimeZone handles timezone day boundaries', () => {
  const utcMoment = '2026-01-01T07:30:00.000Z';

  assert.equal(toDateStringInTimeZone(utcMoment, 'UTC'), '2026-01-01');
  assert.equal(
    toDateStringInTimeZone(utcMoment, 'America/Vancouver'),
    '2025-12-31',
  );
});

test('normalizeContactRecord migrates legacy timestamp and legacy photo data', () => {
  const original = {
    id: 'abc',
    name: 'Legacy User',
    timestamp: '2026-02-01T12:00:00.000Z',
    imageFileName: 'legacy.jpg',
  };
  const legacyPhotoDataUri = 'data:image/jpeg;base64,AAA=';

  const firstPass = normalizeContactRecord(original, {
    now: new Date('2026-03-11T10:00:00.000Z'),
    legacyPhotoDataUri,
  });

  assert.equal(firstPass.changed, true);
  assert.equal(firstPass.contact.createdAt, '2026-02-01T12:00:00.000Z');
  assert.equal(firstPass.contact.updatedAt, '2026-02-01T12:00:00.000Z');
  assert.equal(firstPass.contact.timestamp, '2026-02-01T12:00:00.000Z');
  assert.equal(firstPass.contact.updatedLocalDate, '2026-02-01');
  assert.equal(firstPass.contact.photo, legacyPhotoDataUri);
  assert.equal(firstPass.contact.pdfFileName, 'contact_abc.pdf');

  const secondPass = normalizeContactRecord(firstPass.contact, {
    now: new Date('2026-03-11T10:00:00.000Z'),
  });

  assert.equal(secondPass.changed, false);
  assert.deepEqual(secondPass.contact, firstPass.contact);
});

test('shouldDeleteUpdateFolder keeps <= 10 days and removes older folders', () => {
  const today = new Date('2026-03-11T15:00:00.000Z');

  assert.equal(shouldDeleteUpdateFolder('update_2026-03-01', today, 10), false);
  assert.equal(shouldDeleteUpdateFolder('update_2026-02-28', today, 10), true);
  assert.equal(shouldDeleteUpdateFolder('misc_folder', today, 10), false);
});

test('soft-delete lifecycle marks pending, filters active, expires, and restores', () => {
  const now = new Date('2026-03-11T10:00:00.000Z');
  const soon = new Date('2026-03-11T10:00:15.000Z');
  const later = new Date('2026-03-11T10:00:45.000Z');

  const base = {
    id: 'c1',
    name: 'John',
    updatedLocalDate: '2026-03-11',
  };

  const softDeleted = markContactSoftDeleted(base, now, 30000);
  assert.equal(isPendingDeletion(softDeleted, soon), true);
  assert.equal(hasExpiredPendingDeletion(softDeleted, soon), false);
  assert.equal(isPendingDeletion(softDeleted, later), false);
  assert.equal(hasExpiredPendingDeletion(softDeleted, later), true);

  const activeBeforeExpiry = filterActiveContacts([softDeleted], soon);
  assert.equal(activeBeforeExpiry.length, 0);

  const restored = clearDeleteState(softDeleted);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.pendingDeleteUntil, null);
  assert.equal(filterActiveContacts([restored], later).length, 1);
});

test('findDuplicateContact matches by normalized name + phone or email', () => {
  const contacts = [
    { id: '1', name: 'Jane Smith', phone: '111', email: 'a@example.com' },
    { id: '2', name: 'Mark Smith', phone: '222', email: 'b@example.com' },
  ];

  const duplicatePhone = findDuplicateContact(
    { id: '9', name: '  jAnE sMiTh  ', phone: '111', email: '' },
    contacts,
    '9',
  );
  assert.equal(duplicatePhone && duplicatePhone.id, '1');

  const duplicateEmail = findDuplicateContact(
    { id: '9', name: 'Jane Smith', phone: '', email: 'A@example.com' },
    contacts,
    '9',
  );
  assert.equal(duplicateEmail && duplicateEmail.id, '1');

  const noDuplicate = findDuplicateContact(
    { id: '9', name: 'Jane Smith', phone: '999', email: '' },
    contacts,
    '9',
  );
  assert.equal(noDuplicate, null);
});

test('filterRecentUpdatedContacts keeps active records updated within local window', () => {
  const now = new Date('2026-03-11T10:00:00.000Z');
  const contacts = [
    { id: 'a', updatedLocalDate: '2026-03-11' },
    { id: 'b', updatedLocalDate: '2026-03-05' },
    { id: 'c', updatedLocalDate: '2026-02-20' },
    markContactSoftDeleted(
      { id: 'd', updatedLocalDate: '2026-03-10' },
      now,
      30000,
    ),
  ];

  const result = filterRecentUpdatedContacts(contacts, 10, now);
  const ids = result.map((c) => c.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});
