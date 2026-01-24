const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');

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
    // Default config if file not found
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
        masterListKeywords: 18
      },
      descriptionCharacterLimit: 2000,
      imageSettings: {
        maxWidth: 800,
        maxHeight: 800,
        quality: 85,
        format: 'jpeg'
      }
    };
  }
}

// Determine the user's data directory
const userDataPath = app.getPath('userData');
const contactsFilePath = path.join(userDataPath, 'contacts_data.json');
const pdfsPath = path.join(userDataPath, 'PDFs');
const peoplePath = path.join(pdfsPath, 'People');
const updatesBasePath = path.join(pdfsPath, 'RecentUpdates');
const imagesPath = path.join(pdfsPath, 'Images');

// Create necessary directories
function createDirectories() {
  [pdfsPath, peoplePath, updatesBasePath, imagesPath].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Get or create update folder based on current date
function getUpdateFolderPath() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const folderName = `update_${dateStr}`;
  const updatePath = path.join(updatesBasePath, folderName);

  cleanOldUpdateFolders(today);

  if (!fs.existsSync(updatePath)) {
    fs.mkdirSync(updatePath, { recursive: true });
  }

  return updatePath;
}

// Clean update folders older than 10 days
function cleanOldUpdateFolders(currentDate) {
  if (!fs.existsSync(updatesBasePath)) return;

  const folders = fs.readdirSync(updatesBasePath);
  const tenDaysAgo = new Date(currentDate);
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

  folders.forEach(folder => {
    const match = folder.match(/update_(\d{4}-\d{2}-\d{2})/);
    if (match) {
      const folderDate = new Date(match[1]);
      if (folderDate < tenDaysAgo) {
        const folderPath = path.join(updatesBasePath, folder);
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
    }
  });
}

// Process and save image
async function processAndSaveImage(base64Data, contactName) {
  try {
    // Extract base64 string (remove data:image/...;base64, prefix if present)
    const base64String = base64Data.includes(',') 
      ? base64Data.split(',')[1] 
      : base64Data;
    
    const imageBuffer = Buffer.from(base64String, 'base64');
    
    // Generate filename from contact name
    const lastName = contactName.split(' ').pop() || 'Unknown';
    const firstName = contactName.split(' ')[0] || 'Unknown';
    const fileName = `${lastName}_${firstName}.jpg`;
    const imagePath = path.join(imagesPath, fileName);

    // Process image with sharp - convert to JPEG and resize if needed
    await sharp(imageBuffer)
      .resize(config.imageSettings.maxWidth, config.imageSettings.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: config.imageSettings.quality })
      .toFile(imagePath);

    return {
      fileName: fileName,
      filePath: imagePath
    };
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  }
}

// Load contacts from JSON file
function loadContacts() {
  try {
    if (fs.existsSync(contactsFilePath)) {
      const data = fs.readFileSync(contactsFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading contacts:', error);
  }
  return [];
}

// Save contacts to JSON file
function saveContacts(contacts) {
  try {
    fs.writeFileSync(contactsFilePath, JSON.stringify(contacts, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving contacts:', error);
    return false;
  }
}

// Generate individual person PDF (2 per page layout)
function generatePersonPDF(contact, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const sizes = config.pdfTextSizes;

      doc.pipe(stream);

      // Title - Name
      doc.fontSize(sizes.personName).font('Helvetica-Bold').text(contact.name, { align: 'center' });
      doc.moveDown(0.5);

      // Photo
      if (contact.imageFileName) {
        try {
          const photoPath = path.join(imagesPath, contact.imageFileName);
          if (fs.existsSync(photoPath)) {
            doc.image(photoPath, {
              fit: [250, 250],
              align: 'center'
            });
            doc.moveDown(1);
          }
        } catch (err) {
          console.error('Error adding photo:', err);
        }
      }

      // Keywords
      doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Keywords:', { continued: false });
      doc.fontSize(sizes.personKeywords).font('Helvetica').text(contact.keywords || 'N/A');
      doc.moveDown(0.5);

      // Phone (optional)
      if (contact.phone) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Phone:', { continued: false });
        doc.fontSize(sizes.personPhone).font('Helvetica').text(contact.phone);
        doc.moveDown(0.5);
      }

      // Email (optional)
      if (contact.email) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Email:', { continued: false });
        doc.fontSize(sizes.personEmail).font('Helvetica').text(contact.email);
        doc.moveDown(0.5);
      }

      // Description (optional)
      if (contact.description) {
        doc.fontSize(sizes.sectionLabels).font('Helvetica-Bold').text('Description:', { continued: false });
        doc.fontSize(sizes.personDescription).font('Helvetica').text(contact.description, {
          width: 500,
          align: 'left'
        });
      }

      doc.end();

      stream.on('finish', () => resolve(outputPath));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Generate master list PDF (alphabetical with thumbnails)
function generateMasterListPDF(contacts, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
      const stream = fs.createWriteStream(outputPath);
      const sizes = config.pdfTextSizes;

      doc.pipe(stream);

      // Title
      doc.fontSize(sizes.masterListTitle).font('Helvetica-Bold').text('Contact Master List', { align: 'center' });
      doc.moveDown(1.5);

      // Sort contacts alphabetically
      const sortedContacts = [...contacts].sort((a, b) => a.name.localeCompare(b.name));

      // Process each contact
      sortedContacts.forEach((contact, index) => {
        const startY = doc.y;

        // Check if we need a new page (leaving room for photo + text)
        if (startY > 680) {
          doc.addPage();
        }

        const currentY = doc.y;

        // Add thumbnail photo (left side)
        if (contact.imageFileName) {
          try {
            const photoPath = path.join(imagesPath, contact.imageFileName);
            if (fs.existsSync(photoPath)) {
              doc.image(photoPath, 50, currentY, {
                fit: [60, 60]
              });
            }
          } catch (err) {
            console.error('Error adding thumbnail:', err);
          }
        }

        // Add name and keywords (right side of photo)
        doc.fontSize(sizes.masterListName).font('Helvetica-Bold')
          .text(contact.name, 120, currentY, { width: 430, continued: false });
        
        doc.fontSize(sizes.masterListKeywords).font('Helvetica')
          .text(contact.keywords || 'N/A', 120, currentY + 25, { width: 430, continued: false });

        // Move down for next entry
        doc.y = currentY + 75;

        // Add a light separator line
        if (index < sortedContacts.length - 1) {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  loadConfig();
  createDirectories();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('load-contacts', () => {
  return loadContacts();
});

ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('save-contact', async (event, contact) => {
  try {
    let contacts = loadContacts();
    
    // Process and save image if provided
    if (contact.photo) {
      const imageInfo = await processAndSaveImage(contact.photo, contact.name);
      contact.imageFileName = imageInfo.fileName;
      // Remove base64 data to keep JSON file smaller
      delete contact.photo;
    }

    const existingIndex = contacts.findIndex(c => c.id === contact.id);
    
    if (existingIndex >= 0) {
      // Update existing contact
      contacts[existingIndex] = contact;
    } else {
      // Add new contact
      contacts.push(contact);
    }

    // Save to JSON
    saveContacts(contacts);

    // Generate person PDF
    const lastName = contact.name.split(' ').pop() || 'Unknown';
    const firstName = contact.name.split(' ')[0] || 'Unknown';
    const fileName = `${lastName}_${firstName}.pdf`;

    // Save to People folder
    const peoplePdfPath = path.join(peoplePath, fileName);
    await generatePersonPDF(contact, peoplePdfPath);

    // Save to RecentUpdates folder
    const updateFolder = getUpdateFolderPath();
    const updatePdfPath = path.join(updateFolder, fileName);
    await generatePersonPDF(contact, updatePdfPath);

    // Regenerate master list
    await generateMasterListPDF(contacts, path.join(pdfsPath, 'MasterList.pdf'));

    return { success: true, contact };
  } catch (error) {
    console.error('Error saving contact:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-contact', async (event, contactId) => {
  try {
    let contacts = loadContacts();
    const contactToDelete = contacts.find(c => c.id === contactId);
    
    if (!contactToDelete) {
      return { success: false, error: 'Contact not found' };
    }

    // Remove from array
    contacts = contacts.filter(c => c.id !== contactId);
    saveContacts(contacts);

    // Delete PDF from People folder
    const lastName = contactToDelete.name.split(' ').pop() || 'Unknown';
    const firstName = contactToDelete.name.split(' ')[0] || 'Unknown';
    const fileName = `${lastName}_${firstName}.pdf`;
    const pdfPath = path.join(peoplePath, fileName);

    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    // Delete image file
    if (contactToDelete.imageFileName) {
      const imagePath = path.join(imagesPath, contactToDelete.imageFileName);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

    // Regenerate master list
    await generateMasterListPDF(contacts, path.join(pdfsPath, 'MasterList.pdf'));

    return { success: true };
  } catch (error) {
    console.error('Error deleting contact:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-pdfs-folder', () => {
  const { shell } = require('electron');
  shell.openPath(pdfsPath);
});

ipcMain.handle('get-app-path', () => {
  return userDataPath;
});

// Add this to main.js
ipcMain.handle('print-pdf', (event, fileName) => {
  const pdfPath = path.join(peoplePath, fileName);
  
  // Create a hidden window
  const printWindow = new BrowserWindow({ 
    show: false,
    webPreferences: { nodeIntegration: true }
  });

  // Load the PDF file
  printWindow.loadURL(`file://${pdfPath}`);

  // When loaded, trigger print
  printWindow.webContents.on('did-finish-load', () => {
    printWindow.webContents.print({}, (success, errorType) => {
      if (!success) console.log("Print failed:", errorType);
      printWindow.close();
    });
  });

  return { success: true };
});

ipcMain.handle('view-master-list', () => {
  const pdfPath = path.join(pdfsPath, 'MasterList.pdf');

  if (!fs.existsSync(pdfPath)) {
      return { success: false, error: "Master List not found. Add a contact first." };
  }

  const viewerWindow = new BrowserWindow({ 
    width: 1024,
    height: 800,
    title: "Master List Preview",
    autoHideMenuBar: true, // Hides the File/Edit menu for a cleaner look
    webPreferences: { 
      plugins: true // Important: This allows the built-in PDF viewer
    }
  });

  viewerWindow.loadURL(`file://${pdfPath}`);
  return { success: true };
});