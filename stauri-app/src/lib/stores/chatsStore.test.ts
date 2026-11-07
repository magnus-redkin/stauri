import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  chatsState,
  loadChats,
  selectChat,
  setSelectedChat,
  resetChats,
  joinByInput,
  spectateCommunityById,
  requestJoinCommunity,
} from './chatsStore.svelte';
import {
  getChats,
  getContacts,
  getCommunities,
  fetchCommunity,
  spectateCommunity,
  generateJoiningRequestsForSigning,
  signJoinRequestData,
  requestToJoinCommunity,
  normalizeChatId,
  normalizeHex,
  channelIdFromInvite,
  communityIdFromInvite,
} from '$lib/status/messaging';
import {
  subscribeChannel,
  resetChannelSubscriptions,
} from './chatSubscriptions.svelte';

// Мокаем API мессенджинга. `communityChannels` и предикаты оставляем
// настоящими: они чистая логика, и мокать их значило бы проверять мок.
vi.mock('$lib/status/messaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/status/messaging')>();
  return {
    ...actual,
    getChats: vi.fn(),
    getContacts: vi.fn(),
    getCommunities: vi.fn(),
    fetchCommunity: vi.fn(),
    spectateCommunity: vi.fn(),
    generateJoiningRequestsForSigning: vi.fn(),
    signJoinRequestData: vi.fn(),
    requestToJoinCommunity: vi.fn(),
  };
});

vi.mock('./statusStore.svelte', () => ({
  statusState: { backendPort: 12345, publicKey: '0xownkey' },
}));

vi.mock('$lib/utils/user', () => ({
  getDisplayName: (entity: any) =>
    entity.displayName || entity.alias || entity.name || entity.id.slice(0, 8),
}));

// Значения chatType из internal/protocol/chat.go
const TYPE_ONE_TO_ONE = 1;
const TYPE_PUBLIC = 2;
const TYPE_COMMUNITY = 6;

describe('chatsStore', () => {
  beforeEach(() => {
    resetChats();
    resetChannelSubscriptions();
    vi.clearAllMocks();
    (getCommunities as any).mockResolvedValue([]);
  });

  it('должен загружать чаты и контакты', async () => {
    const previews = [
      { id: '0x123', name: 'Chat 1', chatType: TYPE_ONE_TO_ONE, lastMessage: { text: 'Hello' }, active: true },
      { id: '0x456', name: 'Chat 2', chatType: TYPE_ONE_TO_ONE, lastMessage: { text: 'World' }, active: false },
    ];
    const contacts = [{ id: '0x123', alias: 'Alice' }];

    (getChats as any).mockResolvedValue(previews);
    (getContacts as any).mockResolvedValue({ result: contacts });

    await loadChats();

    expect(chatsState.items).toHaveLength(2);
    expect(chatsState.contacts).toHaveLength(1);
    expect(chatsState.loaded).toBe(true);
    expect(chatsState.items[0].name).toBe('Alice'); // Из контакта
    expect(chatsState.items[1].name).toBe('Chat 2'); // Из чата
  });

  it('различает личные чаты и публичные каналы по числовому chatType', async () => {
    (getChats as any).mockResolvedValue([
      { id: '0xabc', name: 'DM', chatType: TYPE_ONE_TO_ONE, active: true },
      { id: 'status', name: 'Status', chatType: TYPE_PUBLIC, active: true },
    ]);
    (getContacts as any).mockResolvedValue({ result: [] });

    await loadChats();

    expect(chatsState.items.find(c => c.id === '0xabc')?.type).toBe('direct');
    expect(chatsState.items.find(c => c.id === 'status')?.type).toBe('channel');
  });

  it('показывает канал сообщества, если он добавлен пользователем', async () => {
    const communities = [
      {
        id: '0xcomm',
        name: 'Test Community',
        joined: true,
        chats: {
          general: { id: 'general', name: 'general', canPost: true, canView: true, categoryID: 'cat-1' },
        },
        categories: { 'cat-1': { id: 'cat-1', name: 'Main' } },
      },
    ];
    (getChats as any).mockResolvedValue([
      { id: '0xdm', name: 'DM', chatType: TYPE_ONE_TO_ONE, active: true },
    ]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue(communities);
    // Пользователь открыл канал из каталога — отметка есть.
    subscribeChannel('0xcommgeneral');

    await loadChats();

    // id канала в ответе — склейка communityID + channelID, как Chat.id в
    // status-go (community.ChatID).
    const channel = chatsState.items.find(c => c.id === '0xcommgeneral');
    expect(channel).toBeDefined();
    expect(channel?.type).toBe('community');
    expect(channel?.communityId).toBe('0xcomm');
    expect(channel?.communityName).toBe('Test Community');
    expect(channel?.categoryId).toBe('cat-1');

    // Добавленные каналы идут первыми — внешние источники не вытеснят чаты.
    expect(chatsState.items[0].id).toBe('0xcommgeneral');
  });

  it('не показывает канал сообщества без отметки — список не должен быть списком сообществ', async () => {
    // Просмотр сообщества создаёт `Chat`-записи для ВСЕХ каналов, поэтому
    // одного факта существования чата недостаточно: в левой панели должны
    // остаться только чаты 1-1 и каналы, добавленные из каталога.
    const communities = [
      {
        id: '0xcomm',
        name: 'Test Community',
        joined: true,
        chats: {
          general: { id: 'general', name: 'general', canPost: true, canView: true },
          news: { id: 'news', name: 'news', canPost: true, canView: true },
        },
        categories: {},
      },
    ];
    (getChats as any).mockResolvedValue([
      { id: '0xdm', name: 'DM', chatType: TYPE_ONE_TO_ONE, active: true },
      { id: '0xcommgeneral', name: 'general', chatType: TYPE_COMMUNITY, active: true },
      { id: '0xcommnews', name: 'news', chatType: TYPE_COMMUNITY, active: true },
    ]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue(communities);

    await loadChats();

    expect(chatsState.items.map(c => c.id)).toEqual(['0xdm']);
  });

  it('дополняет канал сообщества последним сообщением из превью', async () => {
    const communities = [
      {
        id: '0xcomm',
        name: 'C',
        joined: true,
        chats: { general: { id: 'general', name: 'general', canPost: true, canView: true } },
        categories: {},
      },
    ];
    (getChats as any).mockResolvedValue([
      {
        id: '0xcommgeneral',
        name: 'general',
        chatType: TYPE_COMMUNITY,
        active: true,
        lastMessage: { text: 'latest' },
        unviewedMessagesCount: 3,
      },
    ]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue(communities);
    subscribeChannel('0xcommgeneral');

    await loadChats();

    const channel = chatsState.items.find(c => c.id === '0xcommgeneral');
    expect(channel?.lastMessage).toBe('latest');
    expect(channel?.unreadCount).toBe(3);
    // Не должно быть дубликата.
    expect(chatsState.items.filter(c => c.id === '0xcommgeneral')).toHaveLength(1);
  });

  it('не падает, если сообщества недоступны', async () => {
    (getChats as any).mockResolvedValue([]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockRejectedValue(new Error('not supported'));

    await loadChats();

    expect(chatsState.loaded).toBe(true);
    expect(chatsState.items).toHaveLength(0);
  });

  it('должен выбирать чат по id', () => {
    chatsState.items = [
      { id: '0x123', name: 'Chat 1' } as any,
      { id: '0x456', name: 'Chat 2' } as any,
    ];

    selectChat('0x456');

    expect(chatsState.selected?.id).toBe('0x456');
    expect(chatsState.selected?.name).toBe('Chat 2');
  });

  it('должен выбирать объект чата напрямую', () => {
    const chat = { id: '0x789', name: 'Chat 3' } as any;
    setSelectedChat(chat);
    expect(chatsState.selected).toEqual(chat);
  });

  it('не должен загружать чаты, если loaded=true и force=false', async () => {
    chatsState.loaded = true;
    await loadChats();
    expect(getChats).not.toHaveBeenCalled();
  });

  it('должен сбрасывать состояние', () => {
    chatsState.items = [{ id: '0x123' } as any];
    chatsState.selected = { id: '0x123' } as any;
    chatsState.communities = [{ id: '0xc' } as any];
    chatsState.loaded = true;

    resetChats();

    expect(chatsState.items).toHaveLength(0);
    expect(chatsState.communities).toHaveLength(0);
    expect(chatsState.selected).toBeNull();
    expect(chatsState.loaded).toBe(false);
  });
});

// ===========================================================================
// ВСТУПЛЕНИЕ
// ===========================================================================

describe('normalizeChatId / normalizeHex', () => {
  it('принимает имя канала без изменений', () => {
    expect(normalizeChatId('status')).toBe('status');
  });

  it('снимает решётку и пробелы', () => {
    expect(normalizeChatId('  #status  ')).toBe('status');
  });

  it('достаёт имя из ссылки t.me', () => {
    expect(normalizeChatId('https://t.me/status')).toBe('status');
    expect(normalizeChatId('t.me/status')).toBe('status');
    // Хвост ссылки не должен попадать в имя канала.
    expect(normalizeChatId('https://t.me/status/123?x=1')).toBe('status');
  });

  it('добавляет 0x к идентификатору сообщества', () => {
    expect(normalizeHex('abc123')).toBe('0xabc123');
  });

  it('не дублирует 0x', () => {
    expect(normalizeHex('0xabc123')).toBe('0xabc123');
  });

  it('не трогает пустую строку', () => {
    expect(normalizeHex('   ')).toBe('');
    expect(normalizeChatId('   ')).toBe('');
  });
});

describe('communityIdFromInvite', () => {
  it('декодирует реальную ссылку-приглашение Status', () => {
    // Настоящая ссылка: Base64 после /c/ (не ключ!) и base58btc после #.
    // Раньше регулярка брала base64-часть и обрезала её на первом '_',
    // то есть в fetchCommunity уходил мусор.
    const link =
      'https://status.app/c/G0UAAGR0254sGpC8mYb0UborbMAJSIkEhgPewpWlTiIJf7_6f-agXtfg698vSJIsofpwPiaav4DmYzTTmMbQgA2dPCtjWbkgAw==#zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks';

    expect(communityIdFromInvite(link)).toBe(
      '0x03ddf4c625afcbf7fb9fe189e43b9158b70e8f01fe968e41ae49f258aa9b7d1400'
    );
  });

  it('принимает голый ключ после # без схемы', () => {
    const key = 'zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks';
    expect(communityIdFromInvite(`#${key}`)).toBe(
      '0x03ddf4c625afcbf7fb9fe189e43b9158b70e8f01fe968e41ae49f258aa9b7d1400'
    );
  });

  it('пропускает готовый hex-идентификатор как есть', () => {
    const id = '0x' + 'a'.repeat(64);
    expect(communityIdFromInvite(id)).toBe(id);
    expect(communityIdFromInvite(`https://status.app/c/0x${'a'.repeat(64)}#${id}`)).toBe(id);
  });

  it('возвращает строку как есть, если это не base58 и не hex', () => {
    // Пусть бэкенд ответит внятной ошибкой, а не мы теряем ввод.
    expect(communityIdFromInvite('not-a-key')).toBe('not-a-key');
  });
});

describe('channelIdFromInvite', () => {
  it('достаёт UUID канала из cc-ссылки', () => {
    const link =
      'https://status.app/cc/c42488f6-68cc-455c-a206-a820ecd388d0#zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks';
    expect(channelIdFromInvite(link)).toBe('c42488f6-68cc-455c-a206-a820ecd388d0');
  });

  it('приводит UUID к нижнему регистру', () => {
    const link = 'https://status.app/cc/C42488F6-68CC-455C-A206-A820ECD388D0#zQ3shabc';
    expect(channelIdFromInvite(link)).toBe('c42488f6-68cc-455c-a206-a820ecd388d0');
  });

  it('не находит канал в ссылке на сообщество', () => {
    // /c/ — сообщество целиком, конкретного канала в ней нет.
    expect(channelIdFromInvite('https://status.app/c/G0UA==#zQ3shabc')).toBeNull();
  });

  it('отклоняет cc-ссылку с мусором вместо UUID', () => {
    // По этому значению мы ищем канал в Community.chats, поэтому мусор
    // пропускать нельзя — иначе поиск гарантированно промахнётся.
    expect(channelIdFromInvite('https://status.app/cc/not-a-uuid#zQ3shabc')).toBeNull();
  });
});

describe('публичные каналы больше не создаются', () => {
  // `joinChannel` удалён: он вызывал `createPublicChat`, то есть создавал
  // публичный канал без владельца, прав и проверки существования. Для схемы
  // АКК это непригодно — «канал с автором» требует возможности ограничить
  // запись, которой у публичного канала нет.
  beforeEach(() => {
    resetChats();
    vi.clearAllMocks();
    (getChats as any).mockResolvedValue([]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue([]);
  });

  it('отказывает на имя канала и не обращается к бэкенду', async () => {
    const result = await joinByInput('#status');

    expect(result.status).toBe('failed');
    expect(getChats).not.toHaveBeenCalled();
  });

  it('отказывает на любую строку, не похожую на ссылку или 0x-id', async () => {
    const result = await joinByInput('какой-то канал');

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toContain('invite link');
    }
  });

  it('отклоняет пустой ввод', async () => {
    const result = await joinByInput('   ');
    expect(result.status).toBe('failed');
  });
});

describe('spectateCommunityById', () => {
  beforeEach(() => {
    resetChats();
    vi.clearAllMocks();
    (getChats as any).mockResolvedValue([]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue([]);
  });

  it('открывает сообщество для просмотра, а не вступает', async () => {
    (fetchCommunity as any).mockResolvedValue({ id: '0xabc', name: 'Logos' });
    (spectateCommunity as any).mockResolvedValue({});

    const result = await spectateCommunityById('0xabc');

    expect(result).toEqual({ status: 'spectated', name: 'Logos' });
    expect(spectateCommunity).toHaveBeenCalledWith(12345, '0xabc');
  });

  it('не падает, если описание ещё не получено', async () => {
    // fetchCommunity с waitForResponse: false может вернуть null — id уже
    // известен из каталога, и это не повод отказываться от просмотра.
    (fetchCommunity as any).mockResolvedValue(null);
    (spectateCommunity as any).mockResolvedValue({});

    const result = await spectateCommunityById('0xabc');

    expect(result.status).toBe('spectated');
    expect(spectateCommunity).toHaveBeenCalled();
  });

  it('сообщает об ошибке, не бросая исключение', async () => {
    (fetchCommunity as any).mockResolvedValue(null);
    (spectateCommunity as any).mockRejectedValue(new Error('boom'));

    const result = await spectateCommunityById('0xabc');

    expect(result.status).toBe('failed');
    expect(chatsState.isJoining).toBe(false);
  });
});

describe('requestJoinCommunity', () => {
  const communityId = '0x' + 'a'.repeat(64);

  beforeEach(() => {
    resetChats();
    vi.clearAllMocks();
    (getChats as any).mockResolvedValue([]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue([]);
    (fetchCommunity as any).mockResolvedValue({ id: communityId, name: 'Status Inc' });
  });

  it('подписывает адреса и отправляет заявку', async () => {
    (generateJoiningRequestsForSigning as any).mockResolvedValue([
      { data: '0xhash1', account: '0xaddr1' },
      { data: '0xhash2', account: '0xaddr2' },
    ]);
    (signJoinRequestData as any).mockResolvedValue(['0xsig1', '0xsig2']);
    (requestToJoinCommunity as any).mockResolvedValue({});

    const result = await requestJoinCommunity(
      communityId,
      { addressesToReveal: ['0xaddr1', '0xaddr2'], airdropAddress: '0xaddr1' },
      'secret'
    );

    // Даже для открытого сообщества сначала «заявка»: принятие приходит
    // асинхронно, по сигналу, и обещать «вступил» было бы обманом.
    expect(result).toEqual({ status: 'requested', name: 'Status Inc' });
    expect(generateJoiningRequestsForSigning).toHaveBeenCalledWith(
      12345,
      '0xownkey',
      communityId,
      ['0xaddr1', '0xaddr2']
    );
    expect(signJoinRequestData).toHaveBeenCalledWith(
      12345,
      [
        { data: '0xhash1', account: '0xaddr1' },
        { data: '0xhash2', account: '0xaddr2' },
      ],
      'secret'
    );
    expect(requestToJoinCommunity).toHaveBeenCalledWith(
      12345,
      communityId,
      ['0xaddr1', '0xaddr2'],
      ['0xsig1', '0xsig2'],
      '0xaddr1'
    );
  });

  it('требует хотя бы один адрес', async () => {
    const result = await requestJoinCommunity(
      communityId,
      { addressesToReveal: [], airdropAddress: '' },
      'secret'
    );

    expect(result.status).toBe('failed');
    expect(requestToJoinCommunity).not.toHaveBeenCalled();
  });

  it('отказывает, если ни один адрес нельзя подписать', async () => {
    // personal.SignParams пропускает chat- и watch-only аккаунты, поэтому
    // ответ может быть пустым.
    (generateJoiningRequestsForSigning as any).mockResolvedValue([]);

    const result = await requestJoinCommunity(
      communityId,
      { addressesToReveal: ['0xwatch'], airdropAddress: '0xwatch' },
      'secret'
    );

    expect(result.status).toBe('failed');
    expect(signJoinRequestData).not.toHaveBeenCalled();
    expect(requestToJoinCommunity).not.toHaveBeenCalled();
  });

  it('отказывает, если число подписей не совпало с числом адресов', async () => {
    (generateJoiningRequestsForSigning as any).mockResolvedValue([
      { data: '0xhash1', account: '0xaddr1' },
    ]);
    (signJoinRequestData as any).mockResolvedValue([]);

    const result = await requestJoinCommunity(
      communityId,
      { addressesToReveal: ['0xaddr1'], airdropAddress: '0xaddr1' },
      'secret'
    );

    expect(result.status).toBe('failed');
    expect(requestToJoinCommunity).not.toHaveBeenCalled();
  });

  it('подставляет подписываемый адрес, если выбранный нельзя подписать', async () => {
    // airdropAddress обязан входить в addressesToReveal, иначе
    // RequestToJoinCommunity.Validate ответит
    // ErrRequestToJoinNoAirdropAddressAmongAddressesToReveal.
    (generateJoiningRequestsForSigning as any).mockResolvedValue([
      { data: '0xhash1', account: '0xaddr1' },
    ]);
    (signJoinRequestData as any).mockResolvedValue(['0xsig1']);
    (requestToJoinCommunity as any).mockResolvedValue({});

    await requestJoinCommunity(
      communityId,
      { addressesToReveal: ['0xaddr1', '0xwatch'], airdropAddress: '0xwatch' },
      'secret'
    );

    expect(requestToJoinCommunity).toHaveBeenCalledWith(
      12345,
      communityId,
      ['0xaddr1'],
      ['0xsig1'],
      '0xaddr1'
    );
  });
});

describe('joinByInput', () => {
  beforeEach(() => {
    resetChats();
    vi.clearAllMocks();
    (getChats as any).mockResolvedValue([]);
    (getContacts as any).mockResolvedValue({ result: [] });
    (getCommunities as any).mockResolvedValue([]);
    (fetchCommunity as any).mockResolvedValue(null);
    (spectateCommunity as any).mockResolvedValue({});
  });

  it('не создаёт публичный канал по имени', async () => {
    // Публичные каналы исключены из подключения: у них нет владельца и
    // прав, а каталога не существует — найти можно только по точному имени.
    const result = await joinByInput('#status');
    expect(result.status).toBe('failed');
    expect(spectateCommunity).not.toHaveBeenCalled();
  });

  it('ведёт hex-идентификатор в spectateCommunity', async () => {
    // Для сообщества входное действие — просмотр, а не вступление:
    // вступление требует выбора адресов и пароля и идёт с экрана превью.
    const hex = '0x' + 'a'.repeat(64);
    const result = await joinByInput(hex);
    expect(result.status).toBe('spectated');
    expect(spectateCommunity).toHaveBeenCalledWith(12345, hex);
  });

  it('достаёт идентификатор из короткой ссылки-приглашения', async () => {
    // Формат status.app/c#<ключ> — без base64-части после /c/.
    const id = 'zQ3shabc';
    await joinByInput(`https://status.app/c#${id}`);
    expect(spectateCommunity).toHaveBeenCalledWith(12345, id);
  });

  it('ведёт полную ссылку-приглашение в spectateCommunity с раскодированным id', async () => {
    const link =
      'https://status.app/c/G0UAAGR0254sGpC8mYb0UborbMAJSIkEhgPewpWlTiIJf7_6f-agXtfg698vSJIsofpwPiaav4DmYzTTmMbQgA2dPCtjWbkgAw==#zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks';
    await joinByInput(link);
    expect(spectateCommunity).toHaveBeenCalledWith(
      12345,
      '0x03ddf4c625afcbf7fb9fe189e43b9158b70e8f01fe968e41ae49f258aa9b7d1400'
    );
  });
});
