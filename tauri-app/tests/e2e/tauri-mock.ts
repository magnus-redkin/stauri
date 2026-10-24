// Этот скрипт внедряется в браузер Playwright перед загрузкой приложения
// Он создает мок объекта __TAURI_INTERNALS__, чтобы фронтенд не падал

export const tauriMockScript = `
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      console.log('[Tauri Mock] invoke called:', cmd, args);

      // Мок для start_backend
      if (cmd === 'start_backend') {
        return {
          port: 12345,
          dataDir: '/tmp/mock-sepolia',
          networkName: 'sepolia',
          chainId: 11155111,
          rpcUrl: 'https://rpc.sepolia.org',
          wakuFleet: 'status.test',
          isTestnet: true
        };
      }

      // Мок для stop_backend
      if (cmd === 'stop_backend') {
        return;
      }

      // По умолчанию возвращаем null для неизвестных команд
      return null;
    },

    // Другие необходимые методы Tauri internals (если потребуются)
    transformCallback: () => {},
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' }
    }
  };

  // Также мокаем старое имя (на всякий случай)
  window.__TAURI__ = window.__TAURI_INTERNALS__;

  console.log('[Tauri Mock] Successfully injected');
`;
