# Quick Start Guide

## For Developers (Building the App)

### 1. Install Node.js
Download and install from: https://nodejs.org/ (LTS version)

### 2. Setup Project
```bash
# Navigate to project folder
cd ContactBook

# Install dependencies
npm install
```

### 3. Test the App
```bash
# Run in development mode
npm start
```

### 4. Build Executables

**Windows:**
```bash
npm run build:win
```
Output: `dist/contact_book_windows.exe`

**Mac:**
```bash
npm run build:mac
```
Output: `dist/contact_book_mac.dmg`

### 5. Share the Executables
Upload the files from `dist/` folder to:
- GitHub Releases
- Google Drive  
- Dropbox
- Your preferred file sharing service

---

## For End Users (Using the App)

### Installation

**Windows:**
1. Download `contact_book_windows.exe`
2. Double-click to install
3. Follow the wizard
4. Launch from Start Menu

**Mac:**
1. Download `contact_book_mac.dmg`
2. Open the DMG file
3. Drag app to Applications
4. Launch from Applications

### First Steps

1. **Click "Add New Contact"**

2. **Upload a Photo** (drag & drop or click to browse)

3. **Fill Required Fields:**
   - Name
   - Keywords (e.g., "Grandson, Family")

4. **Optional Fields:**
   - Phone
   - Email
   - Description

5. **Click "Save Contact"**

6. **Click "Open PDFs Folder"** to access printable files

### Folder Structure

Your PDFs will be organized like this:

```
PDFs/
├── MasterList.pdf              ← Alphabetical list of everyone
├── People/                     ← Individual contact pages
│   ├── Flynn_Brendan.pdf
│   └── Smith_Mary.pdf
└── RecentUpdates/              ← Recently added/edited
    └── update_2026-01-24/
        └── Flynn_Brendan.pdf
```

### Printing

**Master List:**
- Open `MasterList.pdf`
- Print for quick reference with thumbnails

**Individual Pages:**
- Go to `People/` folder
- Print specific contact PDFs
- Use for detailed binder pages

**Recent Updates:**
- Go to `RecentUpdates/update_YYYY-MM-DD/`
- Print only recently changed contacts
- Replace old pages in your binder

---

## Sharing Data Between Computers

### Option 1: Cloud Sync (Recommended)

1. Install app on each computer
2. Move the PDFs folder to:
   - Dropbox
   - Google Drive
   - OneDrive
3. Everyone accesses the same files

### Option 2: Git Repository

```bash
# Create a data repository
git init ContactBookData
cd ContactBookData

# Add your data
cp -r /path/to/PDFs .
cp contacts_data.json .

# Commit and push
git add .
git commit -m "Contact data"
git push
```

Other users can clone and sync:
```bash
git clone https://github.com/yourusername/ContactBookData.git
```

---

## Common Commands

```bash
# Development
npm start              # Run app in dev mode
npm run build         # Build for current platform
npm run build:win     # Build for Windows
npm run build:mac     # Build for macOS

# Maintenance  
npm install           # Install/update dependencies
npm update            # Update packages
```

---

## File Checklist

Before building, ensure you have:
- [ ] main.js
- [ ] preload.js
- [ ] renderer.js
- [ ] index.html
- [ ] styles.css
- [ ] config.json
- [ ] package.json

---

## Troubleshooting

**Build fails?**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

**App won't start?**
```bash
# Test in dev mode first
npm start
```

**Need to change text sizes?**
Edit `config.json` and adjust the values in `pdfTextSizes`

---

## Support

See full documentation:
- **README.md** - Complete build instructions
- **USER_GUIDE.md** - Detailed user manual
- **config.json** - Customization options