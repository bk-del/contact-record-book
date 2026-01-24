const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadContacts: () => ipcRenderer.invoke('load-contacts'),
  saveContact: (contact) => ipcRenderer.invoke('save-contact', contact),
  deleteContact: (contactId) => ipcRenderer.invoke('delete-contact', contactId),
  openPDFsFolder: () => ipcRenderer.invoke('open-pdfs-folder'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  printPDF: (fileName) => ipcRenderer.invoke('print-pdf', fileName),
  viewMasterList: () => ipcRenderer.invoke('view-master-list')
  
});