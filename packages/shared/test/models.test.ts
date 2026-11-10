import { describe, expect, it } from 'vitest';
import { Effort } from '../src/enums.ts';
import {
  ClaudeEffort,
  catalogueModel,
  DEFAULT_WINDOWS,
  effortsOf,
  MODEL_CATALOGUE,
  MODEL_ID_MAX,
  ModelId,
  modelProvider,
  OpenaiEffort,
  PROVIDER_EFFORTS,
} from '../src/models.ts';

const ids = (provider: 'claude' | 'openai') => MODEL_CATALOGUE[provider].map((model) => model.id);
const efforts = (id: string) => catalogueModel(id)?.efforts;

describe('the model catalogue', () => {
  it("offers Claude's Claude 5 family by name, each with a 1M window and Claude Code's five levels", () => {
    expect(MODEL_CATALOGUE.claude.map(({ id, label }) => [id, label])).toEqual([
      ['claude-opus-5-5', 'Opus 5.5'],
      ['claude-sonnet-5-5', 'Sonnet 5.5'],
      ['claude-haiku-5-5', 'Haiku 5.5'],
      ['claude-fable-5-1', 'Fable 5.1'],
    ]);
    for (const model of MODEL_CATALOGUE.claude) {
      expect(model.window).toBe(1_000_000);
      expect(model.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    }
  });

  it('offers the models Codex lists for a ChatGPT sign-in, in its order, at 272k, each with its own levels', () => {
    expect(MODEL_CATALOGUE.openai.map(({ id, label }) => [id, label])).toEqual([
      ['gpt-6.1-sol', 'GPT-6.1 Sol'],
      ['gpt-6-astra', 'GPT-6 Astra'],
      ['gpt-6-sol', 'GPT-6 Sol'],
      ['gpt-6-luna', 'GPT-6 Luna'],
      ['gpt-5.6-sol', 'GPT-5.6 Sol'],
      ['gpt-5.6-terra', 'GPT-5.6 Terra'],
      ['gpt-5.6-luna', 'GPT-5.6 Luna'],
      ['gpt-5.5', 'GPT-5.5'],
    ]);
    for (const model of MODEL_CATALOGUE.openai) expect(model.window).toBe(272_000);
    const all = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    for (const id of ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6-terra'])
      expect(efforts(id), id).toEqual(all);
    for (const id of ['gpt-6-luna', 'gpt-5.6-luna']) expect(efforts(id), id).toEqual(all.slice(0, 5));
    expect(efforts('gpt-5.5')).toEqual(all.slice(0, 4));
  });

  it("lists each id once, within the id limits, its levels the provider's, low to high", () => {
    const every = [...ids('claude'), ...ids('openai')];
    expect(new Set(every).size).toBe(every.length);
    for (const provider of ['claude', 'openai'] as const) {
      for (const model of MODEL_CATALOGUE[provider]) {
        expect(ModelId.safeParse(model.id).success, model.id).toBe(true);
        expect(model.efforts.every((effort) => PROVIDER_EFFORTS[provider].includes(effort))).toBe(true);
        const order = model.efforts.map((effort) => Effort.options.indexOf(effort));
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }
    }
  });

  it("has each provider's levels, together exactly the stored ones", () => {
    expect(ClaudeEffort.options).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(OpenaiEffort.options).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(PROVIDER_EFFORTS).toEqual({ claude: ClaudeEffort.options, openai: OpenaiEffort.options });
    expect(new Set([...ClaudeEffort.options, ...OpenaiEffort.options])).toEqual(new Set(Effort.options));
    expect(ClaudeEffort.safeParse('ultra').success).toBe(false);
  });

  it('sizes a profile without a model as every current model of its provider', () => {
    expect(DEFAULT_WINDOWS).toEqual({ claude: 1_000_000, openai: 272_000 });
  });
});

describe('catalogueModel', () => {
  it('finds a model by id in any case, of one provider or of either', () => {
    expect(catalogueModel(' GPT-6.1-Sol ')?.label).toBe('GPT-6.1 Sol');
    expect(catalogueModel('claude-opus-5-5', 'claude')?.label).toBe('Opus 5.5');
    expect(catalogueModel('claude-opus-5-5', 'openai')).toBeUndefined();
    expect(catalogueModel('claude-opus-4-8')).toBeUndefined();
  });
});

describe('modelProvider', () => {
  it("tells a Claude id or alias from an OpenAI one, and says nothing of an id it can't place", () => {
    for (const id of ['claude-opus-5-5', 'Claude-Sonnet-5', 'opus', 'sonnet[1m]', 'haiku', 'fable'])
      expect(modelProvider(id), id).toBe('claude');
    for (const id of ['gpt-6.1-sol', 'GPT-5.5', 'o3', 'o4-mini', 'codex-mini-latest', 'codex-default'])
      expect(modelProvider(id), id).toBe('openai');
    for (const id of ['llama-4', 'mistral-large', 'deepseek-v3']) expect(modelProvider(id), id).toBeNull();
  });
});

describe('effortsOf', () => {
  it("is a known model's levels, else the provider's (a typed-in model, or the default)", () => {
    expect(effortsOf('openai', 'gpt-5.5')).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(effortsOf('openai', 'gpt-7-preview')).toEqual(OpenaiEffort.options);
    expect(effortsOf('openai', null)).toEqual(OpenaiEffort.options);
    expect(effortsOf('claude', 'claude-opus-5-5')).toEqual(ClaudeEffort.options);
    // A model of the other provider is not the profile's: its provider's own levels.
    expect(effortsOf('claude', 'gpt-6.1-sol')).toEqual(ClaudeEffort.options);
  });
});

describe('ModelId', () => {
  it('takes one word of the model characters, up to the limit', () => {
    for (const id of ['claude-opus-5-5[1m]', 'gpt-6.1-sol', 'us.anthropic.claude-opus-5-5', 'openai/gpt-5'])
      expect(ModelId.safeParse(id).success, id).toBe(true);
    for (const id of ['', '-model', 'two words', 'a;b', 'x'.repeat(MODEL_ID_MAX + 1)])
      expect(ModelId.safeParse(id).success, id).toBe(false);
  });
});
