export interface StartBackendResponse {
  port: number;
  dataDir: string;
}

export interface InitializeResponse {
  accounts: any[] | null;
}

export interface LoginSettings {
  "display-name": string;
  "public-key": string;
  mnemonic: string;
  "key-uid": string;
  // ... другие поля, которые нам понадобятся
}

export interface NodeLoginEvent {
  type: "node.login";
  event: {
    settings: LoginSettings;
    account: any;
  };
  timestamp: number;
}
