const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadContacts: () => ipcRenderer.invoke('load-contacts'),
  saveContact: (contact) => ipcRenderer.invoke('save-contact', contact),
  deleteContact: (contactId) => ipcRenderer.invoke('delete-contact', contactId),
  softDeleteContact: (contactId) =>
    ipcRenderer.invoke('soft-delete-contact', contactId),
  undoDeleteContact: (contactId) =>
    ipcRenderer.invoke('undo-delete-contact', contactId),
  openPDFsFolder: () => ipcRenderer.invoke('open-pdfs-folder'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  printContact: (contactId) => ipcRenderer.invoke('print-contact', contactId),
  viewMasterList: () => ipcRenderer.invoke('view-master-list'),
  createFullBook: () => ipcRenderer.invoke('create-full-book'),
  createNewBook: () => ipcRenderer.invoke('create-new-book'),
  createRecentUpdatesBook: () =>
    ipcRenderer.invoke('create-recent-updates-book'),
  exportBackup: () => ipcRenderer.invoke('export-backup'),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  controlWindow: (action) => ipcRenderer.send('window-control', action),
});
