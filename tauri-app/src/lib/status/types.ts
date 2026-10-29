export interface StartBackendResponse {
  port: number;
  dataDir: string;
  networkName: string;
  chainId: number;
  rpcUrl: string;
  wakuFleet: string;
  isTestnet: boolean;
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
      /** Трёхсловный псевдоним, например "Sarcastic Kind Eidolonhelvum". */
      alias?: string;
    };
  };
}

export interface GenericEvent extends StatusEventBase {
  event: any;
}

export type StatusEvent = NodeLoginEvent | MessagesNewEvent | GenericEvent;

export interface WalletBalance {
  symbol: string;
  balance: string; // wei или минимальные единицы, в виде строки
  decimals: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  from: string;
  text: string;
  timestamp: number;
}

export interface MessagesNewEvent extends StatusEventBase {
  type: 'messages.new';
  event: {
    messages: ChatMessage[];
  };
}
