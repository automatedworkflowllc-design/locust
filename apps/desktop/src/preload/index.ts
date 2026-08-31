import { contextBridge, ipcRenderer } from 'electron'

export interface DesktopApi {
  platform: NodeJS.Platform
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
}

const desktopApi: DesktopApi = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
