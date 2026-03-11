const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

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
        personName: 28, personKeywords: 18, personPhone: 18,
        personEmail: 18, personDescription: 16, sectionLabels: 14,
        masterListTitle: 24, masterListName: 18, masterListKeywords: 18
      }
    };
  }
}

// Data Paths
const userDataPath = app.getPath('userData');
const contactsFilePath = path.join(userDataPath, 'contacts_data.json');
const pdfsPath = path.join(userDataPath, 'PDFs');
const peoplePath = path.join(pdfsPath, 'People');
const updatesBasePath = path.join(pdfsPath, 'RecentUpdates');
const defaultImagePath = path.join(__dirname, 'assets', 'default-user.jpeg');

function createDirectories() {
  [pdfsPath, peoplePath, updatesBasePath].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function loadContacts() {
  try {
    if (fs.existsSync(contactsFilePath)) {
      return JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
    }
  } catch (error) { console.error('Error loading contacts:', error); }
  return [];
}

function saveContacts(contacts) {
  try {
    fs.writeFileSync(contactsFilePath, JSON.stringify(contacts, null, 2), 'utf8');
    return true;
  } catch (error) { return false; }
}

// Helper: Get Image Buffer (from Base64 or Default File)
function getImageBuffer(contact) {
  if (contact.photo) {
 
    const base64Data = contact.photo.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, 'base64');
  } else if (fs.existsSync(defaultImagePath)) {
    return fs.readFileSync(defaultImagePath);
  }
  return null;
}

// Generate PDF for a Person
function generatePersonPDF(contact, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const sizes = config.pdfTextSizes;

      doc.pipe(stream);

      // Name
      doc.fontSize(sizes.personName).font('Helvetica-Bold').text(contact.name, { align: 'center' });
      doc.moveDown(0.5);

      // Photo (From JSON Base64 or Default)
      const imgBuffer = getImageBuffer(contact);
      if (imgBuffer) {
        try {
          // Calculate Center X: (Page Width - Image Width) / 2
          const imageWidth = 250;
          const x = (doc.page.width - imageWidth) / 2;
          
          doc.image(imgBuffer, x, doc.y, { 
            fit: [imageWidth, imageWidth], 
            align: 'center' 
          });
          doc.moveDown(1);
        } catch (err) {
          console.error('Error adding photo:', err);
        }
      }

      // Details
      doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Keywords:', { continued: false });
      doc.fontSize(sizes.personKeywords).font('Helvetica').text(contact.keywords || 'N/A');
      doc.moveDown(0.5);

      if (contact.phone) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Phone:', { continued: false });
        doc.fontSize(sizes.personPhone).font('Helvetica').text(contact.phone);
        doc.moveDown(0.5);
      }
      if (contact.email) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Email:', { continued: false });
        doc.fontSize(sizes.personEmail).font('Helvetica').text(contact.email);
        doc.moveDown(0.5);
      }
      if (contact.description) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Notes:', { continued: false });
        doc.fontSize(sizes.personDescription).font('Helvetica').text(contact.description);
      }

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) { reject(error); }
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
      doc.fontSize(sizes.masterListTitle).font('Helvetica-Bold').text('Contact Master List', { align: 'center' });
      doc.moveDown(1.5);

      const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));

      sorted.forEach((contact, index) => {
        if (doc.y > 680) doc.addPage();
        const currentY = doc.y;

        // Thumbnail
        const imgBuffer = getImageBuffer(contact);
        if (imgBuffer) {
          try {
            doc.image(imgBuffer, 50, currentY, { fit: [60, 60] });
          } catch (err) {}
        }

        doc.fontSize(sizes.masterListName).font('Helvetica-Bold')
           .text(contact.name, 120, currentY, { width: 430 });
        
        doc.fontSize(sizes.masterListKeywords).font('Helvetica')
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
    } catch (error) { reject(error); }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true
    }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  loadConfig();
  createDirectories();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC HANDLERS ---

ipcMain.handle('load-contacts', () => loadContacts());
ipcMain.handle('get-config', () => {
  return { ...config, userDataPath: userDataPath };
});
ipcMain.handle('save-contact', async (event, contact) => {
  try {
    let contacts = loadContacts();
 
    const existingIndex = contacts.findIndex(c => c.id === contact.id);
    if (existingIndex >= 0) contacts[existingIndex] = contact;
    else contacts.push(contact);

    saveContacts(contacts);

    // Generate PDFs
    const safeName = contact.name.replace(/[^a-z0-9]/gi, '_');
    const fileName = `${safeName}.pdf`;

    await generatePersonPDF(contact, path.join(peoplePath, fileName));
    await generateMasterListPDF(contacts, path.join(pdfsPath, 'MasterList.pdf'));

    return { success: true, contact };
  } catch (error) {
    console.error(error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-contact', async (event, contactId) => {
  try {
    let contacts = loadContacts();
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return { success: false, error: 'Not found' };

    contacts = contacts.filter(c => c.id !== contactId);
    saveContacts(contacts);

    const safeName = contact.name.replace(/[^a-z0-9]/gi, '_');
    const pdfPath = path.join(peoplePath, `${safeName}.pdf`);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);

    await generateMasterListPDF(contacts, path.join(pdfsPath, 'MasterList.pdf'));
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('print-pdf', (event, fileName) => {
  const pdfPath = path.join(peoplePath, fileName);
  const win = new BrowserWindow({ show: false });
  win.loadURL(`file://${pdfPath}`);
  win.webContents.on('did-finish-load', () => {
    win.webContents.print({}, () => win.close());
  });
  return { success: true };
});

ipcMain.handle('view-master-list', () => {
  const pdfPath = path.join(pdfsPath, 'MasterList.pdf');
  if (!fs.existsSync(pdfPath)) return { success: false, error: "No Master List found" };
  const win = new BrowserWindow({ width: 1024, height: 800, title: "Master List" });
  win.loadURL(`file://${pdfPath}`);
  return { success: true };
});

ipcMain.handle('open-pdfs-folder', () => {
  shell.openPath(pdfsPath);
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

function generateBookPDF(contacts, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));

      sorted.forEach((contact, index) => {
        if (index > 0) doc.addPage();

        doc.fontSize(config.pdfTextSizes.personName).font('Helvetica-Bold').text(contact.name, { align: 'center' });
        doc.moveDown(0.5);

        let imgBuffer = null;
        if (contact.photo) {
           const base64Data = contact.photo.replace(/^data:image\/\w+;base64,/, "");
           imgBuffer = Buffer.from(base64Data, 'base64');
        } else if (fs.existsSync(defaultImagePath)) {
           imgBuffer = fs.readFileSync(defaultImagePath);
        }

        if (imgBuffer) {
          try {
            // Calculate Center X
            const imageWidth = 250;
            const x = (doc.page.width - imageWidth) / 2;

            doc.image(imgBuffer, x, doc.y, { 
              fit: [imageWidth, imageWidth], 
              align: 'center' 
            });
          } catch(e) {}
        }
        doc.moveDown(1);
        
        const sizes = config.pdfTextSizes;
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Keywords:', { continued: false });
        doc.fontSize(sizes.personKeywords).font('Helvetica').text(contact.keywords || 'N/A');
        doc.moveDown(0.5);
        
        if (contact.phone) {
          doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Phone:', { continued: false });
          doc.fontSize(sizes.personPhone).font('Helvetica').text(contact.phone);
          doc.moveDown(0.5);
        }
        if (contact.email) {
          doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Email:', { continued: false });
          doc.fontSize(sizes.personEmail).font('Helvetica').text(contact.email);
          doc.moveDown(0.5);
        }
        if (contact.description) {
          doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Notes:', { continued: false });
          doc.fontSize(sizes.personDescription).font('Helvetica').text(contact.description);
        }
      });

      doc.end();
      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) { reject(error); }
  });
}

ipcMain.handle('create-full-book', async () => {
  const contacts = loadContacts();
  const pdfPath = path.join(pdfsPath, 'Full_Contacts_Book.pdf');
  await generateBookPDF(contacts, pdfPath);
  shell.openPath(pdfPath);
  return { success: true };
});

ipcMain.handle('create-new-book', async () => {
  const contacts = loadContacts();
  
  const today = new Date().toISOString().split('T')[0];
  const newContacts = contacts.filter(c => c.timestamp && c.timestamp.startsWith(today));

  if (newContacts.length === 0) return { success: false, count: 0 };

  const pdfPath = path.join(pdfsPath, `New_Contacts_${today}.pdf`);
  await generateBookPDF(newContacts, pdfPath);
  shell.openPath(pdfPath);
  return { success: true, count: newContacts.length };
});