import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

/**
 * Вырезает отладочный вывод из production-бандла.
 *
 * Vite 8 работает на rolldown и опцию `esbuild.drop` больше не применяет
 * (она помечена deprecated и молча игнорируется). rolldown умеет
 * `compress.dropConsole`, но he достать до него можно только через
 * `build.rolldownOptions.output.minify`, перезаписывая настройки минификации,
 * которые Vite собирает сам — хрупко и версионно-зависимо.
 *
 * Поэтому вырезаем на уровне AST-разбора через rollup-хук renderChunk:
 * детерминированно и не зависит от внутренностей бандлера.
 *
 * Удаляются только вызовы, стоящие отдельным выражением, — `const x = console.log(...)`
 * не трогаем, потому что там был бы важен результат.
 */
/**
 * @param {{ methods: string[] }} options
 */
function dropConsolePlugin({ methods }) {
  const names = methods.map((m) => `console.${m}`).join('|');
  // Весь вызов целиком, включая аргументы (учитываем вложенные скобки и строки).
  const call = `(?:${names})\\s*\\(`;
  return {
    name: 'stauri:drop-console',
    apply: 'build',
    enforce: 'post',
    /**
     * @param {string} code
     */
    renderChunk(code) {
      let out = '';
      let i = 0;
      while (i < code.length) {
        const match = new RegExp(call, 'g');
        match.lastIndex = i;
        const found = match.exec(code);
        if (!found) {
          out += code.slice(i);
          break;
        }
        out += code.slice(i, found.index);
        // Ищем парную закрывающую скобку, пропуская строки и шаблоны.
        let depth = 1;
        let j = found.index + found[0].length;
        let quote = null;
        while (j < code.length && depth > 0) {
          const ch = code[j];
          if (quote) {
            if (ch === '\\') { j += 2; continue; }
            if (ch === quote) quote = null;
          } else if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
          } else if (ch === '(') {
            depth++;
          } else if (ch === ')') {
            depth--;
          }
          j++;
        }
        // Проверяем, что это выражение-оператор, а не часть присваивания.
        const before = out.replace(/\s+$/, '');
        const isStatementStart = before === '' || /[;{}]$/.test(before);
        if (isStatementStart) {
          i = j; // вырезаем целиком
        } else {
          out += code.slice(found.index, j);
          i = j;
        }
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    sveltekit(),
    ...(mode === 'production'
      ? [dropConsolePlugin({ methods: ['log', 'debug', 'info', 'warn', 'trace'] })]
      : []),
  ],

  // 🔥 Исправление для Svelte 5 + Vitest: используем клиентскую версию Svelte
  resolve: mode === 'test' ? { conditions: ['browser'] } : {},

  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Строка projects: [] удалена
    // isolate: false,
  },

  // Tauri development options
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
    : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
