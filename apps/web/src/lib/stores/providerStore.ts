import { create } from 'zustand';
import { apiClient } from '../api-client/client';

export interface LlmProvider {
  id: string;
  name: string;
  provider: 'openai_compatible' | 'lmstudio' | 'mock';
  model: string;
  baseUrl: string;
  isActive: boolean;
  status: 'ready' | 'unreachable' | 'unknown';
  hasApiKey: boolean;
  apiKeyMasked?: string;
  lastTestAt?: string;
  createdAt: string;
}

interface ProviderState {
  providers: LlmProvider[];
  active: LlmProvider | null;
  envConfigured: boolean;
  loading: boolean;
  testingId: string | null;
  load: () => Promise<void>;
  create: (input: { name: string; provider: string; model: string; baseUrl: string; apiKey?: string; activate?: boolean }) => Promise<void>;
  update: (id: string, input: Partial<LlmProvider> & { apiKey?: string; apiKeyKeep?: boolean }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  test: (id: string) => Promise<{ status: string; latencyMs: number; message: string; modelsCount?: number }>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  active: null,
  envConfigured: false,
  loading: false,
  testingId: null,

  load: async () => {
    set({ loading: true });
    try {
      const [list, status] = await Promise.all([
        apiClient.llmListProviders(),
        apiClient.llmStatus(),
      ]);
      set({ providers: list, active: status.active, envConfigured: status.envConfigured, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (input) => {
    await apiClient.llmCreate(input);
    await get().load();
  },

  update: async (id, input) => {
    await apiClient.llmUpdate(id, input);
    await get().load();
  },

  remove: async (id) => {
    await apiClient.llmDelete(id);
    await get().load();
  },

  activate: async (id) => {
    await apiClient.llmActivate(id);
    await get().load();
  },

  test: async (id) => {
    set({ testingId: id });
    try {
      const r = await apiClient.llmTest(id);
      await get().load();
      return r;
    } finally {
      set({ testingId: null });
    }
  },
}));
