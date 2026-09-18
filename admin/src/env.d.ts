/// <reference types="vite/client" />

declare global {
  interface Window {
    /** Served by the API from its own environment — see backend/src/adminPanel.js */
    __ADMIN_ENV__?: {
      supabaseUrl: string;
      supabaseAnonKey: string;
      commit?: string;
      env?: string;
    };
  }
}

export {};
