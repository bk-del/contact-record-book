let contacts = [];
let config = null;
let currentContactId = null;
let currentPhoto = null;

// DOM Elements
const listView = document.getElementById('listView');
const formView = document.getElementById('formView');
const detailView = document.getElementById('detailView');
const contactsGrid = document.getElementById('contactsGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const contactForm = document.getElementById('contactForm');
const addContactBtn = document.getElementById('addContactBtn');
const backBtn = document.getElementById('backBtn');
const cancelBtn = document.getElementById('cancelBtn');
const openPdfsBtn = document.getElementById('openPdfsBtn');
const backToListBtn = document.getElementById('backToListBtn');
const editBtn = document.getElementById('editBtn');
const deleteBtn = document.getElementById('deleteBtn');
const printBtn = document.getElementById('printBtn');
const viewMasterBtn = document.getElementById('viewMasterBtn');

// Form inputs
const contactIdInput = document.getElementById('contactId');
const photoInput = document.getElementById('photoInput');
const photoUploadArea = document.getElementById('photoUploadArea');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const photoPreview = document.getElementById('photoPreview');
const photoImg = document.getElementById('photoImg');
const removePhotoBtn = document.getElementById('removePhotoBtn');
const nameInput = document.getElementById('nameInput');
const keywordsInput = document.getElementById('keywordsInput');
const phoneInput = document.getElementById('phoneInput');
const emailInput = document.getElementById('emailInput');
const descriptionInput = document.getElementById('descriptionInput');
const charCount = document.getElementById('charCount');
const formTitle = document.getElementById('formTitle');

// Initialize app
async function init() {
  config = await window.electronAPI.getConfig();
  await loadContacts();
  setupEventListeners();
  showView('list');
}

// Load contacts from storage
async function loadContacts() {
  contacts = await window.electronAPI.loadContacts();
  renderContacts();
}

// Render contacts grid
function renderContacts(filter = '') {
  const filteredContacts = contacts.filter(contact => {
    const searchTerm = filter.toLowerCase();
    return contact.name.toLowerCase().includes(searchTerm) ||
           (contact.keywords && contact.keywords.toLowerCase().includes(searchTerm));
  });

  if (filteredContacts.length === 0) {
    contactsGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  
  contactsGrid.innerHTML = filteredContacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(contact => {
      const keywords = contact.keywords 
        ? contact.keywords.split(',').map(k => `<span class="keyword-tag">${k.trim()}</span>`).join('')
        : '';

      const photoStyle = contact.imageFileName 
        ? `background-image: url('${getImagePath(contact.imageFileName)}'); background-size: cover; background-position: center;`
        : `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center;`;

      const photoContent = contact.imageFileName 
        ? ''
        : `<span style="font-size: 80px; color: white;">${contact.name.charAt(0)}</span>`;

      return `
        <div class="contact-card" data-id="${contact.id}">
          <div class="contact-photo" style="${photoStyle}">${photoContent}</div>
          <div class="contact-name">${contact.name}</div>
          <div class="contact-keywords">${keywords}</div>
        </div>
      `;
    }).join('');

  // Add click handlers
  document.querySelectorAll('.contact-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      showContactDetail(id);
    });
  });
}

// Show specific view
function showView(view) {
  listView.classList.remove('active');
  formView.classList.remove('active');
  detailView.classList.remove('active');

  if (view === 'list') {
    listView.classList.add('active');
  } else if (view === 'form') {
    formView.classList.add('active');
  } else if (view === 'detail') {
    detailView.classList.add('active');
  }
}

// Show contact detail
async function showContactDetail(contactId) {
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return;

  currentContactId = contactId;

  const keywords = contact.keywords 
    ? contact.keywords.split(',').map(k => `<span class="keyword-tag-large">${k.trim()}</span>`).join('')
    : '<span class="keyword-tag-large">N/A</span>';

  let photoHtml;
  if (contact.imageFileName) {
    const imagePath = await getImagePath(contact.imageFileName);
    photoHtml = `<img src="${imagePath}" alt="${contact.name}" style="width: 100%; height: auto; border-radius: 12px;">`;
  } else {
    photoHtml = `
      <div style="width: 100%; height: 400px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; border-radius: 12px;">
        <span style="font-size: 120px; color: white;">${contact.name.charAt(0)}</span>
      </div>
    `;
  }

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-grid">
      <div class="detail-photo">
        ${photoHtml}
      </div>
      <div class="detail-info">
        <h2>${contact.name}</h2>
        
        <div class="info-section">
          <h3>Keywords</h3>
          <div class="keywords-list">${keywords}</div>
        </div>

        ${contact.phone ? `
          <div class="info-section">
            <h3>Phone</h3>
            <p>${contact.phone}</p>
          </div>
        ` : ''}

        ${contact.email ? `
          <div class="info-section">
            <h3>Email</h3>
            <p>${contact.email}</p>
          </div>
        ` : ''}

        ${contact.description ? `
          <div class="info-section">
            <h3>Description</h3>
            <p>${contact.description}</p>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  showView('detail');
}

// Setup event listeners
function setupEventListeners() {
  // Navigation
  addContactBtn.addEventListener('click', () => {
    resetForm();
    formTitle.textContent = 'Add New Contact';
    showView('form');
  });

  backBtn.addEventListener('click', () => {
    resetForm();
    showView('list');
  });

  cancelBtn.addEventListener('click', () => {
    resetForm();
    showView('list');
  });

  backToListBtn.addEventListener('click', () => {
    currentContactId = null;
    showView('list');
  });

  editBtn.addEventListener('click', () => {
    const contact = contacts.find(c => c.id === currentContactId);
    if (contact) {
      populateForm(contact);
      formTitle.textContent = 'Edit Contact';
      showView('form');
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this contact? This will also delete the associated PDF and image files.')) {
      const result = await window.electronAPI.deleteContact(currentContactId);
      if (result.success) {
        await loadContacts();
        currentContactId = null;
        showView('list');
      } else {
        alert('Error deleting contact: ' + result.error);
      }
    }
  });

  viewMasterBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.viewMasterList();
    if (result && !result.success) {
      alert(result.error);
    }
  });

  printBtn.addEventListener('click', async () => {
    const contact = contacts.find(c => c.id === currentContactId);
    if (!contact) return;
    
    // Construct the filename
    const lastName = contact.name.split(' ').pop() || 'Unknown';
    const firstName = contact.name.split(' ')[0] || 'Unknown';
    const fileName = `${lastName}_${firstName}.pdf`;

    // Trigger the print command
    await window.electronAPI.printPDF(fileName);
  });

  openPdfsBtn.addEventListener('click', () => {
    window.electronAPI.openPDFsFolder();
  });

  // Search
  searchInput.addEventListener('input', (e) => {
    renderContacts(e.target.value);
  });

  // Photo upload
  photoPlaceholder.addEventListener('click', () => {
    photoInput.click();
  });

  photoInput.addEventListener('change', handlePhotoSelect);

  removePhotoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removePhoto();
  });

  // Drag and drop
  photoUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    photoPlaceholder.classList.add('drag-over');
  });

  photoUploadArea.addEventListener('dragleave', () => {
    photoPlaceholder.classList.remove('drag-over');
  });

  photoUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    photoPlaceholder.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handlePhotoFile(files[0]);
    }
  });

  // Character counter
  descriptionInput.addEventListener('input', () => {
    charCount.textContent = descriptionInput.value.length;
  });

  // Form submission
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveContact();
  });
}

// Handle photo selection
function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (file && file.type.startsWith('image/')) {
    handlePhotoFile(file);
  }
}

// Handle photo file
function handlePhotoFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    currentPhoto = e.target.result;
    photoImg.src = currentPhoto;
    photoPreview.style.display = 'block';
    photoPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// Remove photo
function removePhoto() {
  currentPhoto = null;
  photoImg.src = '';
  photoPreview.style.display = 'none';
  photoPlaceholder.style.display = 'block';
  photoInput.value = '';
}

// Reset form
function resetForm() {
  contactForm.reset();
  contactIdInput.value = '';
  removePhoto();
  charCount.textContent = '0';
  currentContactId = null;
  formTitle.textContent = 'Add New Contact';
}

// Populate form for editing
function populateForm(contact) {
  contactIdInput.value = contact.id;
  nameInput.value = contact.name;
  keywordsInput.value = contact.keywords || '';
  phoneInput.value = contact.phone || '';
  emailInput.value = contact.email || '';
  descriptionInput.value = contact.description || '';
  charCount.textContent = contact.description ? contact.description.length : 0;

  // We can't restore the photo from imageFileName in the form
  // User will need to re-upload if they want to change it
  currentPhoto = null;
}

// Save contact
async function saveContact() {
  // Validation
  if (!nameInput.value.trim()) {
    alert('Please enter a name');
    return;
  }

  if (!keywordsInput.value.trim()) {
    alert('Please enter at least one keyword');
    return;
  }

  if (!currentPhoto && !contactIdInput.value) {
    alert('Please upload a photo');
    return;
  }

  const contact = {
    id: contactIdInput.value || Date.now().toString(),
    name: nameInput.value.trim(),
    keywords: keywordsInput.value.trim(),
    phone: phoneInput.value.trim(),
    email: emailInput.value.trim(),
    description: descriptionInput.value.trim(),
    photo: currentPhoto, // Will be processed and removed by main process
    timestamp: new Date().toISOString()
  };

  const result = await window.electronAPI.saveContact(contact);

  if (result.success) {
    await loadContacts();
    resetForm();
    showView('list');
  } else {
    alert('Error saving contact: ' + result.error);
  }
}

// Helper function to get image path
async function getImagePath(fileName) {
  const appPath = await window.electronAPI.getAppPath();
  return `file://${appPath}/PDFs/Images/${fileName}`;
}

// Start the app
init();