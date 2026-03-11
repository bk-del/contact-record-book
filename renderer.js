let contacts = [];
let config = null;
let currentContactId = null;
let currentPhoto = null; 

// DOM Elements
const showListBtn = document.getElementById('showListBtn');
const addContactBtn = document.getElementById('addContactBtn');
const viewMasterBtn = document.getElementById('viewMasterBtn');
const openPdfsBtn = document.getElementById('openPdfsBtn');

const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const formView = document.getElementById('formView');

const contactsGrid = document.getElementById('contactsGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');

const backToListBtn = document.getElementById('backToListBtn');
const editBtn = document.getElementById('editBtn');
const deleteBtn = document.getElementById('deleteBtn');
const printBtn = document.getElementById('printBtn');

const contactForm = document.getElementById('contactForm');
const cancelBtn = document.getElementById('cancelBtn');
const saveBtn = document.getElementById('saveBtn');

const fullBookBtn = document.getElementById('fullBookBtn');
const newBookBtn = document.getElementById('newBookBtn');
// Form Inputs
const contactIdInput = document.getElementById('contactId');
const nameInput = document.getElementById('nameInput');
const keywordsInput = document.getElementById('keywordsInput');
const phoneInput = document.getElementById('phoneInput');
const emailInput = document.getElementById('emailInput');
const descriptionInput = document.getElementById('descriptionInput');
const photoInput = document.getElementById('photoInput');
const photoImg = document.getElementById('photoImg');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const removePhotoBtn = document.getElementById('removePhotoBtn');
const charCount = document.getElementById('charCount');

const DEFAULT_IMAGE = 'assets/default-user.jpeg';

// Initialize
async function init() {
  config = await window.electronAPI.getConfig();
  await loadContacts();
  setupEventListeners();
  showView('list');
}

async function loadContacts() {
  contacts = await window.electronAPI.loadContacts();
  renderContacts();
}

// HELPER: Determine the correct image source (New Base64 -> Old File -> Default)
function getContactImage(contact) {
  if (contact.photo) {
    return contact.photo; // New System (Base64)
  }
  if (contact.imageFileName) {
    // Old System (Legacy File Path)
    return `file://${config.userDataPath}/PDFs/Images/${contact.imageFileName}`;
  }
  return DEFAULT_IMAGE;
}

function renderContacts(filter = '') {
  const searchTerm = filter.toLowerCase();
  const filteredContacts = contacts.filter(contact => 
    contact.name.toLowerCase().includes(searchTerm) ||
    (contact.keywords && contact.keywords.toLowerCase().includes(searchTerm))
  );

  if (filteredContacts.length === 0) {
    contactsGrid.innerHTML = '';
    emptyState.style.display = filteredContacts.length === 0 && !filter ? 'block' : 'none';
    return;
  }
  emptyState.style.display = 'none';

  contactsGrid.innerHTML = filteredContacts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(contact => {
      const imgSrc = getContactImage(contact);
      return `
        <div class="contact-card" data-id="${contact.id}">
          <img src="${imgSrc}" class="card-photo" onerror="this.src='${DEFAULT_IMAGE}'">
          <div class="card-name">${contact.name}</div>
          <div class="card-keywords">${contact.keywords}</div>
        </div>
      `;
    }).join('');

  document.querySelectorAll('.contact-card').forEach(card => {
    card.addEventListener('click', () => showContactDetail(card.dataset.id));
  });
}

function showView(viewName) {
  [listView, detailView, formView].forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });

  // Small timeout to prevent visual stuttering during transition
  setTimeout(() => {
    if (viewName === 'list') {
      listView.classList.remove('hidden');
      listView.classList.add('active');
      showListBtn.classList.add('active');
    } else if (viewName === 'detail') {
      detailView.classList.remove('hidden');
      detailView.classList.add('active');
      showListBtn.classList.remove('active');
    } else if (viewName === 'form') {
      formView.classList.remove('hidden');
      formView.classList.add('active');
      showListBtn.classList.remove('active');
    }
  }, 10);
}

async function showContactDetail(id) {
  const contact = contacts.find(c => c.id === id);
  if (!contact) return;
  currentContactId = id;

  const imgSrc = getContactImage(contact);
  const tagsHtml = contact.keywords.split(',').map(k => `<span class="tag">${k.trim()}</span>`).join('');

  document.getElementById('detailContent').innerHTML = `
    <img src="${imgSrc}" class="detail-photo" onerror="this.src='${DEFAULT_IMAGE}'">
    <div class="detail-name">${contact.name}</div>
    <div class="detail-keywords">${tagsHtml}</div>
    
    ${contact.phone ? `<div class="detail-section"><h4>Phone</h4><p>${contact.phone}</p></div>` : ''}
    ${contact.email ? `<div class="detail-section"><h4>Email</h4><p>${contact.email}</p></div>` : ''}
    ${contact.description ? `<div class="detail-section"><h4>Notes</h4><p>${contact.description}</p></div>` : ''}
  `;

  showView('detail');
}

// IMAGE RESIZER: Compresses image before saving to prevent lag
function resizeImage(file, maxWidth, maxHeight, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Compress to JPEG at 80% quality
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function setupEventListeners() {

  // Window Controls
  const closeBtn = document.getElementById('closeBtn');
  const minBtn = document.getElementById('minBtn');
  const maxBtn = document.getElementById('maxBtn');

  if (closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.controlWindow('close'));
  if (minBtn) minBtn.addEventListener('click', () => window.electronAPI.controlWindow('minimize'));
  if (maxBtn) maxBtn.addEventListener('click', () => window.electronAPI.controlWindow('maximize'));
  fullBookBtn.addEventListener('click', async () => {
  fullBookBtn.textContent = 'Generating...'; // Simple feedback
  await window.electronAPI.createFullBook();
  fullBookBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg> Contacts Book PDF`;
});

newBookBtn.addEventListener('click', async () => {
  newBookBtn.textContent = 'Generating...';
  const result = await window.electronAPI.createNewBook();
  newBookBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg> New Contacts Book`;

  if (!result.success && result.count === 0) {
    alert("No contacts found with today's date.");
  }
});

  showListBtn.addEventListener('click', () => showView('list'));
  backToListBtn.addEventListener('click', () => showView('list'));
  
  addContactBtn.addEventListener('click', () => {
    resetForm();
    showView('form');
  });

  cancelBtn.addEventListener('click', () => {
    if(currentContactId) showView('detail');
    else showView('list');
  });

  // Photo Handling with Resizing
  photoPlaceholder.addEventListener('click', () => photoInput.click());
  
  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      // Resize to max 600x600 to keep the app fast
      resizeImage(file, 600, 600, (resizedBase64) => {
        currentPhoto = resizedBase64;
        photoImg.src = currentPhoto;
        removePhotoBtn.style.display = 'block';
      });
    }
  });

  removePhotoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    currentPhoto = null;
    photoInput.value = '';
    photoImg.src = DEFAULT_IMAGE;
    removePhotoBtn.style.display = 'none';
  });

  saveBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim() || !keywordsInput.value.trim()) {
      alert('Name and Keywords are required.');
      return;
    }

    const contact = {
      id: contactIdInput.value || Date.now().toString(),
      name: nameInput.value.trim(),
      keywords: keywordsInput.value.trim(),
      phone: phoneInput.value.trim(),
      email: emailInput.value.trim(),
      description: descriptionInput.value.trim(),
      photo: currentPhoto, 
      timestamp: new Date().toISOString()
    };

    // Preserve old photo connection if we didn't upload a new one
    if (!currentPhoto && currentContactId) {
        const existing = contacts.find(c => c.id === currentContactId);
        if (existing && existing.imageFileName) {
            contact.imageFileName = existing.imageFileName; 
        }
    }

    const result = await window.electronAPI.saveContact(contact);
    if (result.success) {
      await loadContacts();
      showView('list');
    } else {
      alert('Error: ' + result.error);
    }
  });

  editBtn.addEventListener('click', () => {
    const contact = contacts.find(c => c.id === currentContactId);
    if (contact) populateForm(contact);
  });

  deleteBtn.addEventListener('click', async () => {
    if(confirm('Delete this contact?')) {
      await window.electronAPI.deleteContact(currentContactId);
      await loadContacts();
      showView('list');
    }
  });

  printBtn.addEventListener('click', async () => {
    const contact = contacts.find(c => c.id === currentContactId);
    if (!contact) return;
    const safeName = contact.name.replace(/[^a-z0-9]/gi, '_');
    await window.electronAPI.printPDF(`${safeName}.pdf`);
  });

  viewMasterBtn.addEventListener('click', () => window.electronAPI.viewMasterList());
  openPdfsBtn.addEventListener('click', () => window.electronAPI.openPDFsFolder());
  
  searchInput.addEventListener('input', (e) => renderContacts(e.target.value));
  descriptionInput.addEventListener('input', () => charCount.textContent = `${descriptionInput.value.length}/2000`);
}

function resetForm() {
  contactForm.reset();
  contactIdInput.value = '';
  currentContactId = null;
  currentPhoto = null;
  photoImg.src = DEFAULT_IMAGE;
  removePhotoBtn.style.display = 'none';
  document.getElementById('formTitle').textContent = 'New Contact';
}

function populateForm(contact) {
  contactIdInput.value = contact.id;
  nameInput.value = contact.name;
  keywordsInput.value = contact.keywords;
  phoneInput.value = contact.phone || '';
  emailInput.value = contact.email || '';
  descriptionInput.value = contact.description || '';
  
  // Use helper to display correct image
  const imgSrc = getContactImage(contact);
  photoImg.src = imgSrc;
  
  // Only set currentPhoto if it's a Base64 string (editable)
  if(contact.photo) {
      currentPhoto = contact.photo;
      removePhotoBtn.style.display = 'block';
  } else {
      currentPhoto = null;
      // If it's a legacy image, we allow overwriting it, but the 'remove' button is hidden
      // until they add a new one, or we can opt to show it.
      removePhotoBtn.style.display = contact.imageFileName ? 'block' : 'none';
  }
  
  document.getElementById('formTitle').textContent = 'Edit Contact';
  showView('form');
}

init();