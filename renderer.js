let contacts = [];
let config = null;
let currentContactId = null;
let currentPhoto = null;
let currentFilter = 'all';

// DOM Elements
const showListBtn = document.getElementById('showListBtn');
const addContactBtn = document.getElementById('addContactBtn');
const viewMasterBtn = document.getElementById('viewMasterBtn');
const openPdfsBtn = document.getElementById('openPdfsBtn');
const recentUpdatesBtn = document.getElementById('recentUpdatesBtn');
const exportBackupBtn = document.getElementById('exportBackupBtn');
const importBackupBtn = document.getElementById('importBackupBtn');

const listView = document.getElementById('listView');
const detailView = document.getElementById('detailView');
const formView = document.getElementById('formView');

const contactsGrid = document.getElementById('contactsGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const updatedFilter = document.getElementById('updatedFilter');

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

// Feedback UI
const toastContainer = document.getElementById('toastContainer');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');

const DEFAULT_IMAGE = 'assets/default-user.jpeg';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatLocalDate(dateString) {
  if (!dateString) return 'Unknown';
  const parsed = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateString;
  return parsed.toLocaleDateString();
}

function parseLocalDate(dateString) {
  if (!dateString) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) return null;
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTodayLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDayDiff(laterDate, earlierDate) {
  const startLater = new Date(
    laterDate.getFullYear(),
    laterDate.getMonth(),
    laterDate.getDate(),
  );
  const startEarlier = new Date(
    earlierDate.getFullYear(),
    earlierDate.getMonth(),
    earlierDate.getDate(),
  );
  return Math.round(
    (startLater.getTime() - startEarlier.getTime()) / (24 * 60 * 60 * 1000),
  );
}

function normalizeComparableValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getDescriptionLimit() {
  return (config && config.descriptionCharacterLimit) || 2000;
}

function updateCharacterCounter() {
  charCount.textContent = `${descriptionInput.value.length}/${getDescriptionLimit()}`;
}

function getContactImage(contact) {
  if (contact.photo) return contact.photo;

  if (contact.imageFileName && config && config.userDataPath) {
    return encodeURI(
      `file://${config.userDataPath}/PDFs/Images/${contact.imageFileName}`,
    );
  }

  return DEFAULT_IMAGE;
}

function showToast({
  type = 'info',
  message,
  duration = 4000,
  actionLabel,
  onAction,
}) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const text = document.createElement('span');
  text.innerHTML = escapeHtml(message);
  toast.appendChild(text);

  if (actionLabel && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', async () => {
      try {
        await onAction();
      } catch (error) {
        showToast({ type: 'error', message: error.message || 'Action failed' });
      } finally {
        toast.remove();
      }
    });
    toast.appendChild(actionBtn);
  }

  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.remove();
    }, duration);
  }

  return toast;
}

function showConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}) {
  return new Promise((resolve) => {
    modalTitle.textContent = title || 'Confirm Action';
    modalMessage.textContent = message || '';
    modalConfirmBtn.textContent = confirmLabel;
    modalCancelBtn.textContent = cancelLabel;

    modalConfirmBtn.classList.toggle('destructive', Boolean(destructive));
    modalOverlay.classList.remove('hidden');
    modalOverlay.setAttribute('aria-hidden', 'false');

    const close = (result) => {
      modalOverlay.classList.add('hidden');
      modalOverlay.setAttribute('aria-hidden', 'true');
      modalConfirmBtn.classList.remove('destructive');
      modalCancelBtn.onclick = null;
      modalConfirmBtn.onclick = null;
      modalOverlay.onclick = null;
      resolve(result);
    };

    modalCancelBtn.onclick = () => close(false);
    modalConfirmBtn.onclick = () => close(true);
    modalOverlay.onclick = (event) => {
      if (event.target === modalOverlay) {
        close(false);
      }
    };
  });
}

function setBusyState(button, busyText, isBusy) {
  if (!button) return;

  if (!button.dataset.defaultHtml) {
    button.dataset.defaultHtml = button.innerHTML;
  }

  if (isBusy) {
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.defaultHtml;
  }
}

function passesFilter(contact, filterValue) {
  if (filterValue === 'all') return true;

  const updatedDate = parseLocalDate(contact.updatedLocalDate);
  if (!updatedDate) return false;

  if (filterValue === 'today') {
    return contact.updatedLocalDate === getTodayLocalDate();
  }

  if (filterValue === 'last7') {
    const diff = getLocalDayDiff(new Date(), updatedDate);
    return diff >= 0 && diff <= 7;
  }

  return true;
}

function renderContacts(filterText = '', filterValue = currentFilter) {
  const searchTerm = String(filterText || '').toLowerCase();

  const filteredContacts = contacts.filter((contact) => {
    const name = String(contact.name || '').toLowerCase();
    const keywords = String(contact.keywords || '').toLowerCase();
    const searchMatch =
      name.includes(searchTerm) || keywords.includes(searchTerm);
    return searchMatch && passesFilter(contact, filterValue);
  });

  if (filteredContacts.length === 0) {
    contactsGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  contactsGrid.innerHTML = filteredContacts
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map((contact) => {
      const imgSrc = getContactImage(contact);
      return `
        <div class="contact-card" data-id="${escapeAttr(contact.id)}">
          <img src="${escapeAttr(imgSrc)}" class="card-photo" onerror="this.src='${DEFAULT_IMAGE}'">
          <div class="card-name">${escapeHtml(contact.name || '')}</div>
          <div class="card-keywords">${escapeHtml(contact.keywords || '')}</div>
          <div class="card-updated">Updated: ${escapeHtml(formatLocalDate(contact.updatedLocalDate))}</div>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('.contact-card').forEach((card) => {
    card.addEventListener('click', () => showContactDetail(card.dataset.id));
  });
}

function showView(viewName) {
  [listView, detailView, formView].forEach((el) => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });

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
  const contact = contacts.find((c) => c.id === id);
  if (!contact) return;
  currentContactId = id;

  const imgSrc = getContactImage(contact);
  const tagsHtml = String(contact.keywords || '')
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`)
    .join('');

  document.getElementById('detailContent').innerHTML = `
    <img src="${escapeAttr(imgSrc)}" class="detail-photo" onerror="this.src='${DEFAULT_IMAGE}'">
    <div class="detail-name">${escapeHtml(contact.name || '')}</div>
    <div class="detail-updated">Last Updated: ${escapeHtml(formatLocalDate(contact.updatedLocalDate))}</div>
    <div class="detail-keywords">${tagsHtml}</div>

    ${contact.phone ? `<div class="detail-section"><h4>Phone</h4><p>${escapeHtml(contact.phone)}</p></div>` : ''}
    ${contact.email ? `<div class="detail-section"><h4>Email</h4><p>${escapeHtml(contact.email)}</p></div>` : ''}
    ${contact.description ? `<div class="detail-section"><h4>Notes</h4><p>${escapeHtml(contact.description)}</p></div>` : ''}
  `;

  showView('detail');
}

function resizeImage(file, maxWidth, maxHeight, callback) {
  const reader = new FileReader();
  reader.onload = (event) => {
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
      } else if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      callback(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function findDuplicateContactLocally(candidate) {
  const candidateName = normalizeComparableValue(candidate.name);
  if (!candidateName) return null;

  return (
    contacts.find((contact) => {
      if (contact.id === candidate.id) return false;
      if (normalizeComparableValue(contact.name) !== candidateName)
        return false;

      const phoneA = normalizeComparableValue(contact.phone);
      const phoneB = normalizeComparableValue(candidate.phone);
      const emailA = normalizeComparableValue(contact.email);
      const emailB = normalizeComparableValue(candidate.email);

      return Boolean(
        (phoneA && phoneB && phoneA === phoneB) ||
          (emailA && emailB && emailA === emailB),
      );
    }) || null
  );
}

async function saveContactWithDuplicateFlow(payload, allowDuplicate = false) {
  const result = await window.electronAPI.saveContact({
    ...payload,
    allowDuplicate,
  });

  if (result.success) return result;

  if (result.code === 'duplicate_contact' && !allowDuplicate) {
    const duplicate = result.duplicate || {};
    const shouldSaveAnyway = await showConfirmModal({
      title: 'Possible Duplicate Contact',
      message: `A contact named ${duplicate.name || 'this name'} already has a matching phone or email. Save anyway?`,
      confirmLabel: 'Save Anyway',
      cancelLabel: 'Cancel',
    });

    if (!shouldSaveAnyway) return { success: false, canceled: true };

    return saveContactWithDuplicateFlow(payload, true);
  }

  return result;
}

async function loadContacts() {
  const result = await window.electronAPI.loadContacts();
  if (!result.success) {
    contacts = [];
    showToast({
      type: 'error',
      message: `Failed to load contacts: ${result.error || 'Unknown error'}`,
    });
  } else {
    contacts = result.contacts || [];
  }

  renderContacts(searchInput.value || '', currentFilter);
}

async function runActionButton(button, busyText, actionFn) {
  setBusyState(button, busyText, true);
  try {
    await actionFn();
  } finally {
    setBusyState(button, busyText, false);
  }
}

function resetForm() {
  contactForm.reset();
  contactIdInput.value = '';
  currentContactId = null;
  currentPhoto = null;
  photoImg.src = DEFAULT_IMAGE;
  removePhotoBtn.style.display = 'none';
  document.getElementById('formTitle').textContent = 'New Contact';
  updateCharacterCounter();
}

function populateForm(contact) {
  contactIdInput.value = contact.id;
  nameInput.value = contact.name || '';
  keywordsInput.value = contact.keywords || '';
  phoneInput.value = contact.phone || '';
  emailInput.value = contact.email || '';
  descriptionInput.value = contact.description || '';

  const imgSrc = getContactImage(contact);
  photoImg.src = imgSrc;

  if (contact.photo) {
    currentPhoto = contact.photo;
    removePhotoBtn.style.display = 'block';
  } else {
    currentPhoto = null;
    removePhotoBtn.style.display = contact.imageFileName ? 'block' : 'none';
  }

  document.getElementById('formTitle').textContent = 'Edit Contact';
  updateCharacterCounter();
  showView('form');
}

function setupEventListeners() {
  const closeBtn = document.getElementById('closeBtn');
  const minBtn = document.getElementById('minBtn');
  const maxBtn = document.getElementById('maxBtn');

  if (closeBtn)
    closeBtn.addEventListener('click', () =>
      window.electronAPI.controlWindow('close'),
    );
  if (minBtn)
    minBtn.addEventListener('click', () =>
      window.electronAPI.controlWindow('minimize'),
    );
  if (maxBtn)
    maxBtn.addEventListener('click', () =>
      window.electronAPI.controlWindow('maximize'),
    );

  fullBookBtn.addEventListener('click', async () => {
    await runActionButton(fullBookBtn, 'Generating...', async () => {
      const result = await window.electronAPI.createFullBook();
      if (!result.success) {
        showToast({
          type: 'error',
          message: result.error || 'Unable to generate full contact book.',
        });
      } else {
        showToast({
          type: 'success',
          message: `Generated full contact book (${result.count} contacts).`,
        });
      }
    });
  });

  newBookBtn.addEventListener('click', async () => {
    await runActionButton(newBookBtn, 'Generating...', async () => {
      const result = await window.electronAPI.createNewBook();
      if (!result.success) {
        if (result.count === 0) {
          showToast({
            type: 'info',
            message: 'No contacts were updated today.',
          });
        } else {
          showToast({
            type: 'error',
            message:
              result.error || 'Unable to generate updated contacts book.',
          });
        }
      } else {
        showToast({
          type: 'success',
          message: `Generated today's updated contacts (${result.count}).`,
        });
      }
    });
  });

  recentUpdatesBtn.addEventListener('click', async () => {
    await runActionButton(recentUpdatesBtn, 'Generating...', async () => {
      const result = await window.electronAPI.createRecentUpdatesBook();
      if (!result.success) {
        showToast({
          type: 'info',
          message: result.error || 'No recent updates found.',
        });
      } else {
        showToast({
          type: 'success',
          message: `Generated recent updates book (${result.count} contacts).`,
        });
      }
    });
  });

  exportBackupBtn.addEventListener('click', async () => {
    await runActionButton(exportBackupBtn, 'Exporting...', async () => {
      const result = await window.electronAPI.exportBackup();
      if (result.canceled) return;
      if (!result.success) {
        showToast({
          type: 'error',
          message: result.error || 'Backup export failed.',
        });
      } else {
        showToast({
          type: 'success',
          message: `Backup exported: ${result.filePath}`,
        });
      }
    });
  });

  importBackupBtn.addEventListener('click', async () => {
    const shouldImport = await showConfirmModal({
      title: 'Import Backup',
      message:
        'Importing will replace current contact data and PDFs. Continue?',
      confirmLabel: 'Import Backup',
      cancelLabel: 'Cancel',
    });

    if (!shouldImport) return;

    await runActionButton(importBackupBtn, 'Importing...', async () => {
      const result = await window.electronAPI.importBackup();
      if (result.canceled) return;
      if (!result.success) {
        showToast({
          type: 'error',
          message: result.error || 'Backup import failed.',
        });
        return;
      }

      await loadContacts();
      showView('list');
      showToast({
        type: 'success',
        message: `Backup imported (${result.count} contacts).`,
      });
    });
  });

  showListBtn.addEventListener('click', () => showView('list'));
  backToListBtn.addEventListener('click', () => showView('list'));

  addContactBtn.addEventListener('click', () => {
    resetForm();
    showView('form');
  });

  cancelBtn.addEventListener('click', () => {
    if (currentContactId) showView('detail');
    else showView('list');
  });

  photoPlaceholder.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    resizeImage(file, 600, 600, (resizedBase64) => {
      currentPhoto = resizedBase64;
      photoImg.src = currentPhoto;
      removePhotoBtn.style.display = 'block';
    });
  });

  removePhotoBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    currentPhoto = null;
    photoInput.value = '';
    photoImg.src = DEFAULT_IMAGE;
    removePhotoBtn.style.display = 'none';
  });

  saveBtn.addEventListener('click', async () => {
    if (!nameInput.value.trim() || !keywordsInput.value.trim()) {
      showToast({ type: 'error', message: 'Name and keywords are required.' });
      return;
    }

    if (descriptionInput.value.length > getDescriptionLimit()) {
      showToast({
        type: 'error',
        message: `Notes must be ${getDescriptionLimit()} characters or fewer.`,
      });
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
    };

    if (!currentPhoto && currentContactId) {
      const existing = contacts.find((c) => c.id === currentContactId);
      if (existing && existing.imageFileName) {
        contact.imageFileName = existing.imageFileName;
      }
    }

    const duplicate = findDuplicateContactLocally(contact);
    if (duplicate) {
      const proceed = await showConfirmModal({
        title: 'Possible Duplicate Contact',
        message: `${duplicate.name} already has matching contact details. Save anyway?`,
        confirmLabel: 'Save Anyway',
        cancelLabel: 'Cancel',
      });
      if (!proceed) return;
    }

    setBusyState(saveBtn, 'Saving...', true);
    try {
      const result = await saveContactWithDuplicateFlow(
        contact,
        Boolean(duplicate),
      );
      if (result.canceled) return;

      if (result.success) {
        await loadContacts();
        showView('list');
        showToast({ type: 'success', message: 'Contact saved.' });
      } else {
        showToast({
          type: 'error',
          message: result.error || 'Unable to save contact.',
        });
      }
    } finally {
      setBusyState(saveBtn, 'Saving...', false);
    }
  });

  editBtn.addEventListener('click', () => {
    const contact = contacts.find((c) => c.id === currentContactId);
    if (contact) populateForm(contact);
  });

  deleteBtn.addEventListener('click', async () => {
    if (!currentContactId) return;

    const shouldDelete = await showConfirmModal({
      title: 'Delete Contact',
      message:
        'This contact will be hidden immediately. You can undo for 30 seconds.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    });

    if (!shouldDelete) return;

    const result = await window.electronAPI.softDeleteContact(currentContactId);
    if (!result.success) {
      showToast({ type: 'error', message: result.error || 'Delete failed.' });
      return;
    }

    const deletedId = currentContactId;
    await loadContacts();
    showView('list');

    showToast({
      type: 'info',
      message: 'Contact deleted.',
      duration: 30000,
      actionLabel: 'Undo',
      onAction: async () => {
        const undoResult =
          await window.electronAPI.undoDeleteContact(deletedId);
        if (!undoResult.success) {
          showToast({
            type: 'error',
            message: undoResult.error || 'Undo failed.',
          });
          return;
        }

        await loadContacts();
        showToast({ type: 'success', message: 'Contact restored.' });
      },
    });
  });

  printBtn.addEventListener('click', async () => {
    if (!currentContactId) return;

    const result = await window.electronAPI.printContact(currentContactId);
    if (!result.success) {
      showToast({
        type: 'error',
        message: `Print failed: ${result.error || 'Unknown error'}`,
      });
    } else {
      showToast({ type: 'success', message: 'Print dialog opened.' });
    }
  });

  viewMasterBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.viewMasterList();
    if (!result.success) {
      showToast({
        type: 'error',
        message: result.error || 'Unable to open Master List PDF.',
      });
    }
  });

  openPdfsBtn.addEventListener('click', async () => {
    const result = await window.electronAPI.openPDFsFolder();
    if (!result.success) {
      showToast({
        type: 'error',
        message: result.error || 'Unable to open PDF storage folder.',
      });
    }
  });

  updatedFilter.addEventListener('change', (event) => {
    currentFilter = event.target.value;
    renderContacts(searchInput.value, currentFilter);
  });

  searchInput.addEventListener('input', (event) =>
    renderContacts(event.target.value, currentFilter),
  );
  descriptionInput.addEventListener('input', updateCharacterCounter);
}

async function init() {
  const configResult = await window.electronAPI.getConfig();
  if (!configResult.success) {
    showToast({
      type: 'error',
      message: `Failed to load config: ${configResult.error || 'Unknown error'}`,
    });
    return;
  }

  config = configResult.config;
  updateCharacterCounter();
  await loadContacts();
  setupEventListeners();
  showView('list');
}

init();
