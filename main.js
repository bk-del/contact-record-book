const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const PDFDocument = require('pdfkit');
const {
  buildContactPdfFileName,
  buildLegacyPdfFileName,
  clearDeleteState,
  filterActiveContacts,
  filterRecentUpdatedContacts,
  findDuplicateContact,
  getMimeTypeFromFileName,
  hasExpiredPendingDeletion,
  isPendingDeletion,
  markContactSoftDeleted,
  normalizeContactRecord,
  shouldDeleteUpdateFolder,
  toDataUriFromBuffer,
  toLocalDateString,
} = require('./contact-utils');
const {
  buildBackupMetadata,
  findBackupPayloadRoot,
  validateBackupPayload,
} = require('./backup-utils');

const APP_VERSION = (() => {
  try {
    return require('./package.json').version;
  } catch {
    return 'unknown';
  }
})();

const BACKUP_SCHEMA_VERSION = 'crb-backup-v1';
const SOFT_DELETE_WINDOW_MS = 30 * 1000;

let mainWindow;
let config;

// Load configuration
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
  } catch (error) {
    console.error('Error loading config:', error);
    config = {
      pdfTextSizes: {
        personName: 28,
        personKeywords: 18,
        personPhone: 18,
        personEmail: 18,
        personDescription: 16,
        sectionLabels: 14,
        masterListTitle: 24,
        masterListName: 18,
        masterListKeywords: 18,
      },
      descriptionCharacterLimit: 2000,
    };
  }
}

// Data Paths
const userDataPath = app.getPath('userData');
const contactsFilePath = path.join(userDataPath, 'contacts_data.json');
const pdfsPath = path.join(userDataPath, 'PDFs');
const peoplePath = path.join(pdfsPath, 'People');
const imagesPath = path.join(pdfsPath, 'Images');
const updatesBasePath = path.join(pdfsPath, 'RecentUpdates');
const defaultImagePath = path.join(__dirname, 'assets', 'default-user.jpeg');

function createDirectories() {
  [pdfsPath, peoplePath, imagesPath, updatesBasePath].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function ensureContactsFile() {
  if (!fs.existsSync(contactsFilePath)) {
    fs.writeFileSync(contactsFilePath, '[]', 'utf8');
  }
}

function loadRawContacts() {
  try {
    ensureContactsFile();
    const data = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error loading contacts:', error);
    return [];
  }
}

function saveContacts(contacts) {
  try {
    fs.writeFileSync(
      contactsFilePath,
      JSON.stringify(contacts, null, 2),
      'utf8',
    );
    return true;
  } catch (error) {
    console.error('Error saving contacts:', error);
    return false;
  }
}

function readLegacyPhotoDataUri(contact) {
  if (!contact || contact.photo || !contact.imageFileName) return null;

  const legacyImagePath = path.join(imagesPath, contact.imageFileName);
  if (!fs.existsSync(legacyImagePath)) return null;

  try {
    const buffer = fs.readFileSync(legacyImagePath);
    const mimeType = getMimeTypeFromFileName(contact.imageFileName);
    return toDataUriFromBuffer(buffer, mimeType);
  } catch (error) {
    console.error('Error migrating legacy image:', error);
    return null;
  }
}

function migrateContacts(rawContacts) {
  const now = new Date();
  let changed = false;

  const migratedContacts = rawContacts.map((rawContact, index) => {
    const fallbackId = `legacy_${index + 1}`;
    const legacyPhotoDataUri = readLegacyPhotoDataUri(rawContact);
    const result = normalizeContactRecord(rawContact, {
      now,
      fallbackId,
      legacyPhotoDataUri,
    });

    if (result.changed) changed = true;
    return result.contact;
  });

  return { contacts: migratedContacts, changed };
}

function loadContactsWithoutPurge() {
  const rawContacts = loadRawContacts();
  const migrated = migrateContacts(rawContacts);

  if (migrated.changed) {
    saveContacts(migrated.contacts);
  }

  return migrated.contacts;
}

function getCanonicalPdfPath(contact) {
  const fileName = contact.pdfFileName || buildContactPdfFileName(contact.id);
  return path.join(peoplePath, fileName);
}

function getLegacyPdfPathByName(contactName) {
  return path.join(peoplePath, buildLegacyPdfFileName(contactName));
}

function resolveExistingPersonPdfPath(contact) {
  const canonicalPath = getCanonicalPdfPath(contact);
  if (fs.existsSync(canonicalPath)) return canonicalPath;

  const legacyPath = getLegacyPdfPathByName(contact.name);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return null;
}

function decodeContactPhoto(photoData) {
  if (!photoData || typeof photoData !== 'string') return null;

  try {
    const base64Data = photoData.replace(/^data:image\/[\w+.-]+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  } catch {
    return null;
  }
}

// Helper: Get Image Buffer (from Base64, legacy file, or default file)
function getImageBuffer(contact) {
  const photoBuffer = decodeContactPhoto(contact.photo);
  if (photoBuffer) return photoBuffer;

  if (contact.imageFileName) {
    const legacyPath = path.join(imagesPath, contact.imageFileName);
    if (fs.existsSync(legacyPath)) {
      try {
        return fs.readFileSync(legacyPath);
      } catch (error) {
        console.error('Error loading legacy image:', error);
      }
    }
  }

  if (fs.existsSync(defaultImagePath)) {
    return fs.readFileSync(defaultImagePath);
  }

  return null;
}

function cleanupOldUpdateFolders(keepDays = 10) {
  try {
    if (!fs.existsSync(updatesBasePath)) return;

    const today = new Date();
    const entries = fs.readdirSync(updatesBasePath, { withFileTypes: true });

    entries.forEach((entry) => {
      if (!entry.isDirectory()) return;
      if (!shouldDeleteUpdateFolder(entry.name, today, keepDays)) return;

      const stalePath = path.join(updatesBasePath, entry.name);
      fs.rmSync(stalePath, { recursive: true, force: true });
    });
  } catch (error) {
    console.error('Error cleaning update folders:', error);
  }
}

function copyToRecentUpdates(personPdfPath, localDate) {
  const updatesFolder = path.join(updatesBasePath, `update_${localDate}`);
  if (!fs.existsSync(updatesFolder)) {
    fs.mkdirSync(updatesFolder, { recursive: true });
  }

  const destinationPath = path.join(
    updatesFolder,
    path.basename(personPdfPath),
  );
  fs.copyFileSync(personPdfPath, destinationPath);
}

function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function cleanupLegacyPdfFiles(namesToClean, canonicalFileName) {
  const uniqueNames = [...new Set(namesToClean.filter(Boolean))];

  uniqueNames.forEach((name) => {
    const legacyPath = getLegacyPdfPathByName(name);
    if (path.basename(legacyPath) === canonicalFileName) return;
    deleteFileIfExists(legacyPath);
  });
}

function hardDeleteContactFiles(contact) {
  if (!contact) return;
  deleteFileIfExists(getCanonicalPdfPath(contact));

  const legacyPath = getLegacyPdfPathByName(contact.name);
  if (legacyPath !== getCanonicalPdfPath(contact)) {
    deleteFileIfExists(legacyPath);
  }
}

function getContactStateSnapshot(contacts, now = new Date()) {
  const pending = [];
  const expired = [];
  const retained = [];

  for (const contact of contacts) {
    if (hasExpiredPendingDeletion(contact, now)) {
      expired.push(contact);
      continue;
    }
    if (isPendingDeletion(contact, now)) {
      pending.push(contact);
      retained.push(contact);
      continue;
    }
    retained.push(contact);
  }

  const active = filterActiveContacts(retained, now);
  return { retained, active, pending, expired };
}

async function loadContactsWithPurge() {
  const loadedContacts = loadContactsWithoutPurge();
  const now = new Date();
  const snapshot = getContactStateSnapshot(loadedContacts, now);

  if (snapshot.expired.length === 0) {
    return {
      allContacts: snapshot.retained,
      activeContacts: snapshot.active,
      pendingContacts: snapshot.pending,
      removedContacts: [],
    };
  }

  snapshot.expired.forEach(hardDeleteContactFiles);
  if (!saveContacts(snapshot.retained)) {
    throw new Error('Failed to persist contact cleanup state');
  }

  await generateMasterListPDF(
    snapshot.active,
    path.join(pdfsPath, 'MasterList.pdf'),
  );
  return {
    allContacts: snapshot.retained,
    activeContacts: snapshot.active,
    pendingContacts: snapshot.pending,
    removedContacts: snapshot.expired,
  };
}

function sortContactsByName(contacts) {
  return [...contacts].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  );
}

// Generate PDF for a Contact
function generatePersonPDF(contact, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const sizes = config.pdfTextSizes;

      doc.pipe(stream);

      doc
        .fontSize(sizes.personName)
        .font('Helvetica-Bold')
        .text(contact.name || 'Unnamed Contact', { align: 'center' });
      doc.moveDown(0.5);

      const imgBuffer = getImageBuffer(contact);
      if (imgBuffer) {
        try {
          const imageWidth = 250;
          const x = (doc.page.width - imageWidth) / 2;

          doc.image(imgBuffer, x, doc.y, {
            fit: [imageWidth, imageWidth],
            align: 'center',
          });
          doc.moveDown(1);
        } catch (error) {
          console.error('Error adding photo:', error);
        }
      }

      doc
        .fontSize(sizes.sectionLabels)
        .font('Helvetica-Bold')
        .text('Keywords:', { continued: false });
      doc
        .fontSize(sizes.personKeywords)
        .font('Helvetica')
        .text(contact.keywords || 'N/A');
      doc.moveDown(0.5);

      if (contact.phone) {
        doc
          .fontSize(sizes.sectionLabels)
          .font('Helvetica-Bold')
          .text('Phone:', { continued: false });
        doc.fontSize(sizes.personPhone).font('Helvetica').text(contact.phone);
        doc.moveDown(0.5);
      }
      if (contact.email) {
        doc
          .fontSize(sizes.sectionLabels)
          .font('Helvetica-Bold')
          .text('Email:', { continued: false });
        doc.fontSize(sizes.personEmail).font('Helvetica').text(contact.email);
        doc.moveDown(0.5);
      }
      if (contact.description) {
        doc
          .fontSize(sizes.sectionLabels)
          .font('Helvetica-Bold')
          .text('Notes:', { continued: false });
        doc
          .fontSize(sizes.personDescription)
          .font('Helvetica')
          .text(contact.description);
      }

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Generate Master List
function generateMasterListPDF(contacts, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const sizes = config.pdfTextSizes;

      doc.pipe(stream);
      doc
        .fontSize(sizes.masterListTitle)
        .font('Helvetica-Bold')
        .text('Contact Master List', { align: 'center' });
      doc.moveDown(1.5);

      const sorted = sortContactsByName(contacts);

      sorted.forEach((contact, index) => {
        if (doc.y > 680) doc.addPage();
        const currentY = doc.y;

        const imgBuffer = getImageBuffer(contact);
        if (imgBuffer) {
          try {
            doc.image(imgBuffer, 50, currentY, { fit: [60, 60] });
          } catch {
            // keep rendering text even if image fails
          }
        }

        doc
          .fontSize(sizes.masterListName)
          .font('Helvetica-Bold')
          .text(contact.name || 'Unnamed Contact', 120, currentY, {
            width: 430,
          });

        doc
          .fontSize(sizes.masterListKeywords)
          .font('Helvetica')
          .text(contact.keywords || 'N/A', 120, currentY + 25, { width: 430 });

        doc.y = currentY + 75;
        if (index < sorted.length - 1) {
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#CCCCCC');
          doc.moveDown(0.5);
        }
      });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

function printPdfFile(pdfPath) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ show: false });
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      if (!win.isDestroyed()) win.close();
      resolve(result);
    };

    win.webContents.on('did-fail-load', () => {
      done({ success: false, error: 'Failed to load PDF for printing' });
    });

    win.webContents.on('did-finish-load', () => {
      win.webContents.print({}, (success, failureReason) => {
        if (success) {
          done({ success: true });
        } else {
          done({ success: false, error: failureReason || 'Print failed' });
        }
      });
    });

    win.loadURL(`file://${pdfPath}`).catch(() => {
      done({ success: false, error: 'Failed to open PDF' });
    });
  });
}

function openPdfInWindow(pdfPath, title = 'PDF') {
  if (!fs.existsSync(pdfPath)) {
    return { success: false, error: 'PDF file not found' };
  }

  const win = new BrowserWindow({ width: 1024, height: 800, title });
  win.loadURL(`file://${pdfPath}`);
  return { success: true };
}

function generateBookPDF(contacts, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      let settled = false;

      const done = (err, result) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(result);
      };

      stream.on('finish', () => done(null, outputPath));
      stream.on('close', () => done(null, outputPath));
      stream.on('error', done);
      doc.pipe(stream);

      const sorted = sortContactsByName(contacts);

      sorted.forEach((contact, index) => {
        if (index > 0) doc.addPage();

        doc
          .fontSize(config.pdfTextSizes.personName)
          .font('Helvetica-Bold')
          .text(contact.name || 'Unnamed Contact', { align: 'center' });
        doc.moveDown(0.5);

        const imgBuffer = getImageBuffer(contact);
        if (imgBuffer) {
          try {
            const imageWidth = 250;
            const x = (doc.page.width - imageWidth) / 2;

            doc.image(imgBuffer, x, doc.y, {
              fit: [imageWidth, imageWidth],
              align: 'center',
            });
          } catch {
            // keep rendering text even if image fails
          }
        }
        doc.moveDown(1);

        const sizes = config.pdfTextSizes;
        doc
          .fontSize(sizes.sectionLabels)
          .font('Helvetica-Bold')
          .text('Keywords:', { continued: false });
        doc
          .fontSize(sizes.personKeywords)
          .font('Helvetica')
          .text(contact.keywords || 'N/A');
        doc.moveDown(0.5);

        if (contact.phone) {
          doc
            .fontSize(sizes.sectionLabels)
            .font('Helvetica-Bold')
            .text('Phone:', { continued: false });
          doc.fontSize(sizes.personPhone).font('Helvetica').text(contact.phone);
          doc.moveDown(0.5);
        }
        if (contact.email) {
          doc
            .fontSize(sizes.sectionLabels)
            .font('Helvetica-Bold')
            .text('Email:', { continued: false });
          doc.fontSize(sizes.personEmail).font('Helvetica').text(contact.email);
          doc.moveDown(0.5);
        }
        if (contact.description) {
          doc
            .fontSize(sizes.sectionLabels)
            .font('Helvetica-Bold')
            .text('Notes:', { continued: false });
          doc
            .fontSize(sizes.personDescription)
            .font('Helvetica')
            .text(contact.description);
        }
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadFile('index.html');
}

function escapePowerShellLiteral(value) {
  return String(value || '').replace(/'/g, "''");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(stderr.trim() || `${command} exited with code ${code}`),
        );
      }
    });
  });
}

async function createZipFromDirectory(sourceDir, zipPath) {
  if (process.platform === 'win32') {
    const src = escapePowerShellLiteral(sourceDir);
    const dst = escapePowerShellLiteral(zipPath);
    const script = [
      `$src='${src}'`,
      `$dst='${dst}'`,
      'if (Test-Path $dst) { Remove-Item -Path $dst -Force }',
      "Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dst -Force",
    ].join('; ');

    await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    return;
  }

  await runCommand('zip', ['-r', zipPath, '.'], { cwd: sourceDir });
}

async function extractZipToDirectory(zipPath, destinationDir) {
  if (process.platform === 'win32') {
    const src = escapePowerShellLiteral(zipPath);
    const dst = escapePowerShellLiteral(destinationDir);
    const script = [
      `$src='${src}'`,
      `$dst='${dst}'`,
      'Expand-Archive -Path $src -DestinationPath $dst -Force',
    ].join('; ');

    await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    return;
  }

  await runCommand('unzip', ['-o', zipPath, '-d', destinationDir]);
}

function cloneCurrentDataTo(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(contactsFilePath)) {
    fs.copyFileSync(
      contactsFilePath,
      path.join(targetDir, 'contacts_data.json'),
    );
  }

  if (fs.existsSync(pdfsPath)) {
    fs.cpSync(pdfsPath, path.join(targetDir, 'PDFs'), { recursive: true });
  }
}

function restoreDataFrom(snapshotDir) {
  const snapshotContactsPath = path.join(snapshotDir, 'contacts_data.json');
  const snapshotPdfsPath = path.join(snapshotDir, 'PDFs');

  if (fs.existsSync(snapshotContactsPath)) {
    fs.copyFileSync(snapshotContactsPath, contactsFilePath);
  } else {
    fs.writeFileSync(contactsFilePath, '[]', 'utf8');
  }

  fs.rmSync(pdfsPath, { recursive: true, force: true });
  if (fs.existsSync(snapshotPdfsPath)) {
    fs.cpSync(snapshotPdfsPath, pdfsPath, { recursive: true });
  }

  createDirectories();
}

async function exportBackupArchive(destinationPath) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-export-'));
  try {
    const state = await loadContactsWithPurge();
    if (!saveContacts(state.allContacts)) {
      throw new Error('Failed to save contacts before backup export');
    }

    fs.copyFileSync(
      contactsFilePath,
      path.join(stagingDir, 'contacts_data.json'),
    );

    if (fs.existsSync(pdfsPath)) {
      fs.cpSync(pdfsPath, path.join(stagingDir, 'PDFs'), { recursive: true });
    }

    const metadata = buildBackupMetadata(APP_VERSION, new Date());
    metadata.schema = BACKUP_SCHEMA_VERSION;
    fs.writeFileSync(
      path.join(stagingDir, 'backup-metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );

    await createZipFromDirectory(stagingDir, destinationPath);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

async function importBackupArchive(zipPath) {
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-import-'));
  const rollbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crb-rollback-'));

  try {
    cloneCurrentDataTo(rollbackDir);
    await extractZipToDirectory(zipPath, extractDir);

    const payloadRoot = findBackupPayloadRoot(extractDir);
    const validation = validateBackupPayload(payloadRoot);
    if (!validation.valid) {
      throw new Error(validation.error || 'Backup payload is invalid');
    }

    fs.copyFileSync(validation.contactsPath, contactsFilePath);

    fs.rmSync(pdfsPath, { recursive: true, force: true });
    if (validation.pdfsPath && fs.existsSync(validation.pdfsPath)) {
      fs.cpSync(validation.pdfsPath, pdfsPath, { recursive: true });
    }

    createDirectories();
    const state = await loadContactsWithPurge();

    const masterListPath = path.join(pdfsPath, 'MasterList.pdf');
    if (!fs.existsSync(masterListPath)) {
      await generateMasterListPDF(state.activeContacts, masterListPath);
    }

    return { success: true, count: state.activeContacts.length };
  } catch (error) {
    try {
      restoreDataFrom(rollbackDir);
      await loadContactsWithPurge();
    } catch (rollbackError) {
      console.error('Rollback failure during backup import:', rollbackError);
    }

    return { success: false, error: error.message };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.rmSync(rollbackDir, { recursive: true, force: true });
  }
}

app.whenReady().then(async () => {
  loadConfig();
  createDirectories();
  cleanupOldUpdateFolders(10);

  try {
    await loadContactsWithPurge();
  } catch (error) {
    console.error('Startup contact cleanup failed:', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function softDeleteContactById(contactId) {
  const state = await loadContactsWithPurge();
  const contacts = state.allContacts;
  const now = new Date();

  const index = contacts.findIndex((c) => c.id === contactId);
  if (index < 0) return { success: false, error: 'Contact not found' };

  const existing = contacts[index];
  if (isPendingDeletion(existing, now)) {
    return { success: false, error: 'Contact is already pending deletion' };
  }

  contacts[index] = markContactSoftDeleted(
    existing,
    now,
    SOFT_DELETE_WINDOW_MS,
  );

  if (!saveContacts(contacts)) {
    return { success: false, error: 'Failed to save contacts data' };
  }

  const activeContacts = filterActiveContacts(contacts, now);
  await generateMasterListPDF(
    activeContacts,
    path.join(pdfsPath, 'MasterList.pdf'),
  );

  return {
    success: true,
    contactId,
    pendingDeleteUntil: contacts[index].pendingDeleteUntil,
  };
}

// --- IPC HANDLERS ---
ipcMain.handle('load-contacts', async () => {
  try {
    const state = await loadContactsWithPurge();
    return { success: true, contacts: state.activeContacts };
  } catch (error) {
    return { success: false, error: error.message, contacts: [] };
  }
});

ipcMain.handle('get-config', () => {
  return { success: true, config: { ...config, userDataPath } };
});

ipcMain.handle('save-contact', async (event, contact) => {
  try {
    const state = await loadContactsWithPurge();
    const contacts = state.allContacts;
    const activeContacts = state.activeContacts;
    const existingIndex = contacts.findIndex((c) => c.id === contact.id);
    const existingContact = existingIndex >= 0 ? contacts[existingIndex] : null;
    const now = new Date();

    const mergedContact = {
      ...(existingContact || {}),
      ...(contact || {}),
      id:
        (existingContact && existingContact.id) ||
        (contact && contact.id) ||
        String(Date.now()),
      name: String((contact && contact.name) || '').trim(),
      keywords: String((contact && contact.keywords) || '').trim(),
      phone: String((contact && contact.phone) || '').trim(),
      email: String((contact && contact.email) || '').trim(),
      description: String((contact && contact.description) || '').trim(),
      photo:
        contact && Object.prototype.hasOwnProperty.call(contact, 'photo')
          ? contact.photo
          : (existingContact && existingContact.photo) || null,
      imageFileName:
        (contact && contact.imageFileName) ||
        (existingContact && existingContact.imageFileName) ||
        undefined,
    };

    const descriptionLimit = config.descriptionCharacterLimit || 2000;
    if (!mergedContact.name || !mergedContact.keywords) {
      return { success: false, error: 'Name and keywords are required.' };
    }
    if (mergedContact.description.length > descriptionLimit) {
      return {
        success: false,
        error: `Notes must be ${descriptionLimit} characters or fewer.`,
      };
    }

    const normalized = normalizeContactRecord(mergedContact, {
      now,
      fallbackId: mergedContact.id,
    }).contact;

    normalized.createdAt =
      (existingContact && existingContact.createdAt) || normalized.createdAt;
    normalized.updatedAt = now.toISOString();
    normalized.updatedLocalDate = toLocalDateString(now);
    normalized.timestamp = normalized.updatedAt;
    normalized.pdfFileName = buildContactPdfFileName(normalized.id);

    const restored = clearDeleteState(normalized);

    const duplicate = findDuplicateContact(
      restored,
      activeContacts,
      restored.id,
    );
    const allowDuplicate = Boolean(contact && contact.allowDuplicate);
    if (duplicate && !allowDuplicate) {
      return {
        success: false,
        code: 'duplicate_contact',
        error:
          'A similar contact already exists with matching name and phone/email.',
        duplicate: {
          id: duplicate.id,
          name: duplicate.name,
          phone: duplicate.phone,
          email: duplicate.email,
        },
      };
    }

    if (existingIndex >= 0) contacts[existingIndex] = restored;
    else contacts.push(restored);

    if (!saveContacts(contacts)) {
      return { success: false, error: 'Failed to save contacts data' };
    }

    const personPdfPath = getCanonicalPdfPath(restored);
    await generatePersonPDF(restored, personPdfPath);

    const activeAfterSave = filterActiveContacts(contacts, now);
    await generateMasterListPDF(
      activeAfterSave,
      path.join(pdfsPath, 'MasterList.pdf'),
    );

    copyToRecentUpdates(personPdfPath, restored.updatedLocalDate);
    cleanupLegacyPdfFiles(
      [existingContact && existingContact.name, restored.name],
      restored.pdfFileName,
    );

    return { success: true, contact: restored };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('soft-delete-contact', async (event, contactId) => {
  try {
    return await softDeleteContactById(contactId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('undo-delete-contact', async (event, contactId) => {
  try {
    const state = await loadContactsWithPurge();
    const contacts = state.allContacts;
    const now = new Date();

    const index = contacts.findIndex((c) => c.id === contactId);
    if (index < 0) return { success: false, error: 'Contact not found' };

    const existing = contacts[index];
    if (!isPendingDeletion(existing, now)) {
      return {
        success: false,
        error: 'Undo window has expired for this contact',
      };
    }

    contacts[index] = clearDeleteState(existing);

    if (!saveContacts(contacts)) {
      return { success: false, error: 'Failed to save contacts data' };
    }

    const activeContacts = filterActiveContacts(contacts, now);
    await generateMasterListPDF(
      activeContacts,
      path.join(pdfsPath, 'MasterList.pdf'),
    );

    return { success: true, contact: contacts[index] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Backward compatibility alias.
ipcMain.handle('delete-contact', async (event, contactId) => {
  try {
    return await softDeleteContactById(contactId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('print-contact', async (event, contactId) => {
  try {
    const state = await loadContactsWithPurge();
    const contact = state.activeContacts.find((c) => c.id === contactId);
    if (!contact) return { success: false, error: 'Contact not found' };

    const pdfPath = resolveExistingPersonPdfPath(contact);
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return {
        success: false,
        error: 'Contact PDF not found. Save the contact to regenerate it.',
      };
    }

    return await printPdfFile(pdfPath);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('view-master-list', () => {
  try {
    const pdfPath = path.join(pdfsPath, 'MasterList.pdf');
    if (!fs.existsSync(pdfPath))
      return { success: false, error: 'No Master List found' };
    return openPdfInWindow(pdfPath, 'Master List');
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-pdfs-folder', async () => {
  try {
    const openError = await shell.openPath(pdfsPath);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('window-control', (event, action) => {
  if (!mainWindow) return;

  switch (action) {
    case 'close':
      mainWindow.close();
      break;
    case 'minimize':
      mainWindow.minimize();
      break;
    case 'maximize':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
  }
});

ipcMain.handle('create-full-book', async () => {
  try {
    const state = await loadContactsWithPurge();
    const contacts = state.activeContacts;
    if (contacts.length === 0) {
      return { success: false, count: 0, error: 'No contacts found' };
    }

    const pdfPath = path.join(pdfsPath, 'Full_Contacts_Book.pdf');
    await generateBookPDF(contacts, pdfPath);
    const openResult = openPdfInWindow(pdfPath, 'Full Contact Book');
    if (!openResult.success) return openResult;
    return { success: true, count: contacts.length, pdfPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-new-book', async () => {
  try {
    const state = await loadContactsWithPurge();
    const todayLocal = toLocalDateString(new Date());

    const updatedTodayContacts = state.activeContacts.filter(
      (contact) => contact.updatedLocalDate === todayLocal,
    );

    if (updatedTodayContacts.length === 0) {
      return { success: false, count: 0, error: 'No contacts found for today' };
    }

    const pdfPath = path.join(
      pdfsPath,
      `Today_Updated_Contacts_${todayLocal}.pdf`,
    );
    await generateBookPDF(updatedTodayContacts, pdfPath);
    const openResult = openPdfInWindow(pdfPath, "Today's Updated Contacts");
    if (!openResult.success) return openResult;
    return { success: true, count: updatedTodayContacts.length, pdfPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-recent-updates-book', async () => {
  try {
    const state = await loadContactsWithPurge();
    const recentContacts = filterRecentUpdatedContacts(
      state.activeContacts,
      10,
      new Date(),
    );

    if (recentContacts.length === 0) {
      return {
        success: false,
        count: 0,
        error: 'No recent updates found in last 10 days',
      };
    }

    const dateLabel = toLocalDateString(new Date());
    const pdfPath = path.join(pdfsPath, `Recent_Updates_${dateLabel}.pdf`);
    await generateBookPDF(recentContacts, pdfPath);
    const openResult = openPdfInWindow(pdfPath, 'Recent Updates');
    if (!openResult.success) return openResult;
    return { success: true, count: recentContacts.length, pdfPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('export-backup', async () => {
  try {
    const defaultFileName = `contact-record-book-backup-${toLocalDateString(new Date())}.zip`;
    const defaultPath = path.join(app.getPath('documents'), defaultFileName);

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Contact Record Book Backup',
      defaultPath,
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    await exportBackupArchive(saveResult.filePath);
    return { success: true, filePath: saveResult.filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-backup', async () => {
  try {
    const openResult = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Contact Record Book Backup',
      properties: ['openFile'],
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });

    if (
      openResult.canceled ||
      !openResult.filePaths ||
      openResult.filePaths.length === 0
    ) {
      return { success: false, canceled: true };
    }

    const importResult = await importBackupArchive(openResult.filePaths[0]);
    if (!importResult.success) return importResult;

    return {
      success: true,
      count: importResult.count,
      filePath: openResult.filePaths[0],
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
