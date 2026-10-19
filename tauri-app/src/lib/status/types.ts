export interface StartBackendResponse {
  port: number;
  dataDir: string;
}

export interface InitializeResponse {
  accounts: any[] | null;
}

export interface StatusEventBase {
  type: string;
  timestamp: number;
}

export interface NodeLoginEvent extends StatusEventBase {
  type: 'node.login';
  event: {
    error?: string;
    settings?: {
      'key-uid': string;
      'display-name': string;
      'public-key': string;
      mnemonic: string;
    };
  };
}

export interface GenericEvent extends StatusEventBase {
  event: any;
}

export type StatusEvent = NodeLoginEvent | GenericEvent;

export interface WalletBalance {
  symbol: string;
  balance: string; // wei или минимальные единицы, в виде строки
  decimals: number;
}
