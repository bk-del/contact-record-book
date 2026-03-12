const path = require('path');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const UPDATE_FOLDER_REGEX = /^update_(\d{4})-(\d{2})-(\d{2})$/;

function sanitizeFileToken(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildContactPdfFileName(contactId) {
  const token = sanitizeFileToken(contactId) || 'unknown';
  return `contact_${token}.pdf`;
}

function buildLegacyPdfFileName(contactName) {
  const token =
    sanitizeFileToken(String(contactName || '').toLowerCase()) || 'contact';
  return `${token}.pdf`;
}

function toLocalDateString(inputDate = new Date()) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateStringInTimeZone(inputDate, timeZone) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  if (Number.isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

function parseLocalDateString(dateString) {
  const match = UPDATE_FOLDER_REGEX.exec(`update_${dateString}`);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function startOfLocalDay(inputDate) {
  const date = inputDate instanceof Date ? inputDate : new Date(inputDate);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toLocalDayNumber(inputDate) {
  const dayStart = startOfLocalDay(inputDate);
  if (!dayStart) return null;
  return (
    Date.UTC(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate()) /
    MS_PER_DAY
  );
}

function getLocalDayDiff(laterDate, earlierDate) {
  const laterDayNumber = toLocalDayNumber(laterDate);
  const earlierDayNumber = toLocalDayNumber(earlierDate);
  if (laterDayNumber === null || earlierDayNumber === null) return 0;
  return laterDayNumber - earlierDayNumber;
}

function shouldDeleteUpdateFolder(
  folderName,
  today = new Date(),
  keepDays = 10,
) {
  const match = UPDATE_FOLDER_REGEX.exec(folderName);
  if (!match) return false;

  const folderDate = parseLocalDateString(
    `${match[1]}-${match[2]}-${match[3]}`,
  );
  if (!folderDate) return false;

  const ageInDays = getLocalDayDiff(today, folderDate);
  return ageInDays > keepDays;
}

function getMimeTypeFromFileName(fileName) {
  switch (path.extname(String(fileName || '')).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

function toDataUriFromBuffer(buffer, mimeType = 'application/octet-stream') {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function toValidIsoString(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeNullableIso(value) {
  return toValidIsoString(value) || null;
}

function isPendingDeletion(contact, now = new Date()) {
  if (!contact || !contact.deletedAt || !contact.pendingDeleteUntil)
    return false;
  const until = new Date(contact.pendingDeleteUntil);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(until.getTime()) || Number.isNaN(nowDate.getTime()))
    return false;
  return until.getTime() > nowDate.getTime();
}

function hasExpiredPendingDeletion(contact, now = new Date()) {
  if (!contact || !contact.deletedAt || !contact.pendingDeleteUntil)
    return false;
  const until = new Date(contact.pendingDeleteUntil);
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(until.getTime()) || Number.isNaN(nowDate.getTime()))
    return false;
  return until.getTime() <= nowDate.getTime();
}

function filterActiveContacts(contacts, now = new Date()) {
  return (contacts || []).filter(
    (contact) =>
      !isPendingDeletion(contact, now) &&
      !hasExpiredPendingDeletion(contact, now),
  );
}

function filterRecentUpdatedContacts(
  contacts,
  windowDays = 10,
  now = new Date(),
) {
  return filterActiveContacts(contacts, now).filter((contact) => {
    const updatedDate = parseLocalDateString(contact.updatedLocalDate);
    if (!updatedDate) return false;
    const diff = getLocalDayDiff(now, updatedDate);
    return diff >= 0 && diff <= windowDays;
  });
}

function markContactSoftDeleted(
  contact,
  now = new Date(),
  undoWindowMs = 30 * 1000,
) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const pendingDate = new Date(nowDate.getTime() + undoWindowMs);
  return {
    ...contact,
    deletedAt: nowDate.toISOString(),
    pendingDeleteUntil: pendingDate.toISOString(),
  };
}

function clearDeleteState(contact) {
  return {
    ...contact,
    deletedAt: null,
    pendingDeleteUntil: null,
  };
}

function normalizeComparableValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function hasNonEmptyMatch(valueA, valueB) {
  const a = normalizeComparableValue(valueA);
  const b = normalizeComparableValue(valueB);
  return Boolean(a && b && a === b);
}

function findDuplicateContact(candidate, contacts, currentId) {
  const candidateName = normalizeComparableValue(candidate.name);
  if (!candidateName) return null;

  return (
    (contacts || []).find((contact) => {
      if (!contact || contact.id === currentId) return false;
      if (!normalizeComparableValue(contact.name)) return false;
      if (normalizeComparableValue(contact.name) !== candidateName)
        return false;

      return (
        hasNonEmptyMatch(contact.phone, candidate.phone) ||
        hasNonEmptyMatch(contact.email, candidate.email)
      );
    }) || null
  );
}

function normalizeContactRecord(rawContact, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowIso = now.toISOString();
  const fallbackId = options.fallbackId || `legacy_${now.getTime()}`;
  const legacyPhotoDataUri = options.legacyPhotoDataUri || null;
  const contact = { ...(rawContact || {}) };
  let changed = false;

  if (!contact.id) {
    contact.id = fallbackId;
    changed = true;
  }

  const createdAtIso =
    toValidIsoString(contact.createdAt) ||
    toValidIsoString(contact.timestamp) ||
    toValidIsoString(contact.updatedAt) ||
    nowIso;

  if (contact.createdAt !== createdAtIso) {
    contact.createdAt = createdAtIso;
    changed = true;
  }

  const updatedAtIso =
    toValidIsoString(contact.updatedAt) ||
    toValidIsoString(contact.timestamp) ||
    createdAtIso;

  if (contact.updatedAt !== updatedAtIso) {
    contact.updatedAt = updatedAtIso;
    changed = true;
  }

  const resolvedUpdatedLocalDate = parseLocalDateString(
    contact.updatedLocalDate,
  )
    ? contact.updatedLocalDate
    : toLocalDateString(updatedAtIso);

  if (contact.updatedLocalDate !== resolvedUpdatedLocalDate) {
    contact.updatedLocalDate = resolvedUpdatedLocalDate;
    changed = true;
  }

  if (contact.timestamp !== updatedAtIso) {
    contact.timestamp = updatedAtIso;
    changed = true;
  }

  const canonicalPdfFileName = buildContactPdfFileName(contact.id);
  if (contact.pdfFileName !== canonicalPdfFileName) {
    contact.pdfFileName = canonicalPdfFileName;
    changed = true;
  }

  if (!contact.photo && legacyPhotoDataUri) {
    contact.photo = legacyPhotoDataUri;
    changed = true;
  }

  const normalizedDeletedAt = normalizeNullableIso(contact.deletedAt);
  const normalizedPendingDeleteUntil = normalizeNullableIso(
    contact.pendingDeleteUntil,
  );

  if (contact.deletedAt !== normalizedDeletedAt) {
    contact.deletedAt = normalizedDeletedAt;
    changed = true;
  }

  if (contact.pendingDeleteUntil !== normalizedPendingDeleteUntil) {
    contact.pendingDeleteUntil = normalizedPendingDeleteUntil;
    changed = true;
  }

  if (
    (contact.deletedAt && !contact.pendingDeleteUntil) ||
    (!contact.deletedAt && contact.pendingDeleteUntil)
  ) {
    contact.deletedAt = null;
    contact.pendingDeleteUntil = null;
    changed = true;
  }

  return { contact, changed };
}

module.exports = {
  buildContactPdfFileName,
  buildLegacyPdfFileName,
  clearDeleteState,
  filterActiveContacts,
  filterRecentUpdatedContacts,
  findDuplicateContact,
  getLocalDayDiff,
  getMimeTypeFromFileName,
  hasExpiredPendingDeletion,
  isPendingDeletion,
  markContactSoftDeleted,
  normalizeContactRecord,
  parseLocalDateString,
  shouldDeleteUpdateFolder,
  toDataUriFromBuffer,
  toDateStringInTimeZone,
  toLocalDateString,
};
