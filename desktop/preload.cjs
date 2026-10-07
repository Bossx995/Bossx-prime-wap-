const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('bossDesktop', {
  isDesktop: true,
  version: '1.0.0'
});
